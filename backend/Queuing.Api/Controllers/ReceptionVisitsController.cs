using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Queuing.Api.Auth;
using Queuing.Api.Data;
using Queuing.Api.Services;

namespace Queuing.Api.Controllers;

[ApiController]
[Route("api/v1")]
public sealed class ReceptionVisitsController(QueueDbContext db, VisitIssuanceService visitIssuance, TimeProvider clock) : ControllerBase
{
    [HttpGet("services/available")]
    [Authorize(Policy = QueueRoles.QueueServices)]
    public async Task<IActionResult> AvailableServices(CancellationToken cancellationToken) =>
        Ok(await db.Services.AsNoTracking()
            .Where(service => service.Active && service.Department.Active)
            .OrderBy(service => service.Department.Name).ThenBy(service => service.Name)
            .Select(service => new AvailableServiceDto(service.Id, service.Name, service.DepartmentId, service.Department.Name, service.Active))
            .ToArrayAsync(cancellationToken));

    [HttpPost("visits")]
    [Authorize(Policy = QueueRoles.Reception)]
    public async Task<IActionResult> Issue(
        [FromBody] IssueVisitRequest request,
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        CancellationToken cancellationToken)
    {
        var userId = VisitCommandSupport.CurrentUserId(User);
        if (userId is null) return Unauthorized();
        var result = await visitIssuance.IssueAsync(request, idempotencyKey, userId, null, HttpContext.TraceIdentifier, cancellationToken);
        if (result.Error is not null) return Problem(statusCode: result.StatusCode, title: result.Error);
        return result.WasReplay ? Ok(result.Receipt) : Created($"/api/v1/visits/{result.Receipt!.Id}", result.Receipt);
    }

    [HttpGet("visits/{id:guid}")]
    [Authorize(Policy = QueueRoles.Reception)]
    public async Task<IActionResult> GetVisit(Guid id, CancellationToken cancellationToken)
    {
        var visit = await db.Visits.AsNoTracking().Include(item => item.CurrentStep)
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        return visit is null ? NotFound() : Ok(new VisitDto(
            visit.Id, visit.VisitCode, visit.CurrentStep?.DepartmentId, visit.CurrentStep?.State.ToString(),
            visit.CurrentStep?.AppointmentAtUtc, visit.IssuedAtUtc, visit.Completed));
    }

    [HttpGet("reception/visits/receipt")]
    [Authorize(Policy = QueueRoles.Reception)]
    public async Task<IActionResult> FindReceipt(
        [FromQuery] string? visitCode,
        [FromQuery] string? referenceId,
        [FromQuery] string? clinicDate,
        CancellationToken cancellationToken)
    {
        if (!DateOnly.TryParseExact(clinicDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            return Problem(statusCode: 400, title: "Enter a valid clinic date (YYYY-MM-DD).");

        int? sequence = null;
        if (!string.IsNullOrWhiteSpace(visitCode))
        {
            if (!int.TryParse(visitCode, NumberStyles.None, CultureInfo.InvariantCulture, out var parsedSequence) ||
                parsedSequence < 1 || visitCode != parsedSequence.ToString("D3", CultureInfo.InvariantCulture))
                return Problem(statusCode: 400, title: "Enter a canonical visit code (e.g. 001).");
            sequence = parsedSequence;
        }

        var refId = string.IsNullOrWhiteSpace(referenceId) ? null : referenceId.Trim();
        if (refId?.Length > 50)
            return Problem(statusCode: 400, title: "Reference ID cannot exceed 50 characters.");

        if (sequence is null && refId is null)
            return Problem(statusCode: 400, title: "Enter a visit code or reference ID.");

        var query = from step in db.DepartmentSteps.AsNoTracking()
                    join visit in db.Visits.AsNoTracking() on step.VisitId equals visit.Id
                    where visit.ClinicDate == date
                    select new
                    {
                        visit.Id,
                        visit.VisitCode,
                        visit.Sequence,
                        visit.ReferenceId,
                        visit.ClinicDate,
                        visit.IssuedAtUtc,
                        step.ServiceId,
                        ServiceName = step.Service == null ? null : step.Service.Name,
                        step.DepartmentId,
                        DepartmentName = step.Department.Name,
                        step.AppointmentAtUtc,
                        step.DepartmentTicketNumber,
                        step.EnteredAtUtc,
                        StepId = step.Id
                    };

        if (sequence.HasValue)
        {
            query = query.Where(item => item.Sequence == sequence.Value);
        }
        else if (refId is not null)
        {
            query = query.Where(item => item.ReferenceId == refId);
        }

        var receipt = await query
            .OrderByDescending(item => item.Sequence)
            .ThenBy(item => item.EnteredAtUtc)
            .ThenBy(item => item.StepId)
            .FirstOrDefaultAsync(cancellationToken);

        if (receipt is null) return NotFound();

        var userId = VisitCommandSupport.CurrentUserId(User);
        VisitCommandSupport.AddAudit(db, clock, userId, HttpContext.TraceIdentifier, "visit.reprinted", "visit", receipt.Id);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(new IssuedVisitDto(
            receipt.Id, receipt.VisitCode, receipt.ClinicDate, receipt.ServiceId, receipt.ServiceName,
            receipt.DepartmentId, receipt.DepartmentName, receipt.AppointmentAtUtc, receipt.IssuedAtUtc, receipt.DepartmentTicketNumber,
            IsReprint: true, ReferenceId: receipt.ReferenceId));
    }
}

public sealed record AvailableServiceDto(Guid Id, string Name, Guid DepartmentId, string DepartmentName, bool Active);
