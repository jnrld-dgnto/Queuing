using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Queuing.Api.Data;
using Queuing.Core;

namespace Queuing.Api.Services;

public sealed class VisitIssuanceService(QueueDbContext db, TimeProvider clock)
{
    private static readonly TimeZoneInfo ClinicTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila");

    public async Task<VisitIssueResult> IssueAsync(
        IssueVisitRequest request,
        string? idempotencyKey,
        Guid? userId,
        Guid? kioskDeviceId,
        string correlationId,
        CancellationToken cancellationToken)
    {
        if ((userId is null) == (kioskDeviceId is null)) return VisitIssueResult.Failure(401, "An issuing identity is required.");
        var key = VisitCommandSupport.ParseIdempotencyKey(idempotencyKey);
        if (key is null) return VisitIssueResult.Failure(400, "A valid Idempotency-Key is required.");

        var scope = userId is { } actorUserId
            ? $"visit.issue:{actorUserId}"
            : $"visit.issue:kiosk:{kioskDeviceId}";
        var requestHash = VisitCommandSupport.Hash(JsonSerializer.Serialize(request));
        var now = clock.GetUtcNow();
        var clinicDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, ClinicTimeZone).DateTime);
        var clinicDateValue = clinicDate.ToDateTime(TimeOnly.MinValue);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // Locking the daily row serializes issue requests before their idempotency lookup.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO `DailySequences` (`ClinicDate`, `LastSequence`) VALUES ({clinicDateValue}, 0) ON DUPLICATE KEY UPDATE `LastSequence` = `LastSequence`", cancellationToken);
        var dailySequence = await db.DailySequences.FromSqlInterpolated(
                $"SELECT * FROM `DailySequences` WHERE `ClinicDate` = {clinicDateValue} FOR UPDATE")
            .SingleAsync(cancellationToken);

        var replay = await VisitCommandSupport.FindReplayAsync<IssuedVisitDto>(db, scope, key, requestHash, cancellationToken);
        if (replay.Conflict) return VisitIssueResult.Failure(409, "This idempotency key was already used for another request.");
        if (replay.Value is not null) return VisitIssueResult.Replay(replay.Value);

        var appointmentAtUtc = VisitCommandSupport.ParseClinicLocalTime(request.AppointmentAtLocal);
        if (appointmentAtUtc.IsInvalid)
            return VisitIssueResult.Failure(400, "Appointment time must use YYYY-MM-DDTHH:mm in the clinic timezone.");
        var referenceId = string.IsNullOrWhiteSpace(request.ReferenceId) ? null : request.ReferenceId.Trim();
        if (referenceId?.Length > 50) return VisitIssueResult.Failure(400, "Reference ID cannot exceed 50 characters.");
        if (request.InitialServiceId == Guid.Empty) return VisitIssueResult.Failure(400, "Choose an active service.");
        var service = await db.Services.AsNoTracking()
            .Where(item => item.Id == request.InitialServiceId && item.Active && item.Department.Active)
            .Select(item => new { item.Id, item.Name, item.DepartmentId, DepartmentName = item.Department.Name })
            .SingleOrDefaultAsync(cancellationToken);
        if (service is null) return VisitIssueResult.Failure(400, "Choose an active service.");

        var departmentTicketNumber = await VisitCommandSupport.NextDepartmentTicketNumberAsync(
            db, service.DepartmentId, clinicDate, cancellationToken);

        dailySequence.LastSequence++;
        var visit = new Visit
        {
            ClinicDate = clinicDate,
            Sequence = dailySequence.LastSequence,
            VisitCode = dailySequence.LastSequence.ToString("D3", CultureInfo.InvariantCulture),
            IssuedByUserId = userId,
            IssuedByKioskDeviceId = kioskDeviceId,
            IssuedAtUtc = now,
            ReferenceId = referenceId
        };
        db.Visits.Add(visit);
        await db.SaveChangesAsync(cancellationToken);

        var step = new DepartmentStep
        {
            VisitId = visit.Id,
            DepartmentId = service.DepartmentId,
            ServiceId = service.Id,
            TicketDate = clinicDate,
            DepartmentTicketNumber = departmentTicketNumber,
            AppointmentAtUtc = appointmentAtUtc.Value,
            State = DepartmentStepState.Pending,
            EnteredAtUtc = now
        };
        db.DepartmentSteps.Add(step);
        await db.SaveChangesAsync(cancellationToken);
        visit.CurrentStepId = step.Id;
        var receipt = new IssuedVisitDto(
            visit.Id, visit.VisitCode, clinicDate, service.Id, service.Name, service.DepartmentId,
            service.DepartmentName, step.AppointmentAtUtc, visit.IssuedAtUtc, departmentTicketNumber, ReferenceId: referenceId);
        VisitCommandSupport.SaveCommand(db, clock, scope, key, requestHash, visit.Id, receipt);
        VisitCommandSupport.AddAudit(db, clock, userId, correlationId, "visit.issued", "visit", visit.Id, kioskDeviceId);
        VisitCommandSupport.AddOutbox(db, clock, visit.Id, service.DepartmentId);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return VisitIssueResult.Created(receipt);
    }
}

public sealed record VisitIssueResult(IssuedVisitDto? Receipt, string? Error, int StatusCode, bool WasReplay)
{
    public static VisitIssueResult Failure(int statusCode, string error) => new(null, error, statusCode, false);
    public static VisitIssueResult Replay(IssuedVisitDto receipt) => new(receipt, null, 200, true);
    public static VisitIssueResult Created(IssuedVisitDto receipt) => new(receipt, null, 201, false);
}

public sealed record IssueVisitRequest(Guid InitialServiceId, string? AppointmentAtLocal, string? ReferenceId = null);
public sealed record IssuedVisitDto(Guid Id, string VisitCode, DateOnly ClinicDate, Guid? ServiceId, string? ServiceName, Guid DepartmentId, string DepartmentName, DateTimeOffset? AppointmentAtUtc, DateTimeOffset IssuedAtUtc, int? DepartmentTicketNumber = null, bool IsReprint = false, string? ReferenceId = null)
{
    public string TicketNumber => DepartmentTicketNumber?.ToString("D3", CultureInfo.InvariantCulture) ?? VisitCode;
}
