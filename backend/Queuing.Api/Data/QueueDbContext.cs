using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Queuing.Core;

namespace Queuing.Api.Data;

public sealed class QueueDbContext(DbContextOptions<QueueDbContext> options)
    : IdentityDbContext<QueueUser, IdentityRole<Guid>, Guid>(options)
{
    private static readonly ValueConverter<DateOnly, DateTime> ClinicDateConverter = new(
        date => date.ToDateTime(TimeOnly.MinValue),
        dateTime => DateOnly.FromDateTime(dateTime));

    public DbSet<Department> Departments => Set<Department>();
    public DbSet<UserDepartment> UserDepartments => Set<UserDepartment>();
    public DbSet<UserService> UserServices => Set<UserService>();
    public DbSet<ClinicService> Services => Set<ClinicService>();
    public DbSet<Station> Stations => Set<Station>();
    public DbSet<StationService> StationServices => Set<StationService>();
    public DbSet<StationStaff> StationStaff => Set<StationStaff>();
    public DbSet<Visit> Visits => Set<Visit>();
    public DbSet<DepartmentStep> DepartmentSteps => Set<DepartmentStep>();
    public DbSet<DailySequence> DailySequences => Set<DailySequence>();
    public DbSet<DepartmentSequence> DepartmentSequences => Set<DepartmentSequence>();
    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();
    public DbSet<DisplayDevice> DisplayDevices => Set<DisplayDevice>();
    public DbSet<DisplayVideo> DisplayVideos => Set<DisplayVideo>();
    public DbSet<KioskDevice> KioskDevices => Set<KioskDevice>();
    public DbSet<AuditRecord> AuditRecords => Set<AuditRecord>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<QueueUser>(entity =>
        {
            entity.Property(user => user.DisplayName).HasMaxLength(120).IsRequired();
            entity.Property(user => user.MustChangePassword).IsRequired();
            entity.Property(user => user.Active).IsRequired();
            entity.HasMany(user => user.DepartmentAssignments)
                .WithOne(assignment => assignment.User)
                .HasForeignKey(assignment => assignment.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<Department>(entity =>
        {
            entity.Property(department => department.Name).HasMaxLength(100).IsRequired();
            entity.HasIndex(department => department.Name).IsUnique();
        });

        builder.Entity<UserDepartment>(entity =>
        {
            entity.HasKey(assignment => new { assignment.UserId, assignment.DepartmentId });
            entity.HasOne(assignment => assignment.Department)
                .WithMany()
                .HasForeignKey(assignment => assignment.DepartmentId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<UserService>(entity =>
        {
            entity.HasKey(assignment => new { assignment.UserId, assignment.ServiceId });
            entity.HasOne(assignment => assignment.User)
                .WithMany(user => user.ServiceAssignments)
                .HasForeignKey(assignment => assignment.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(assignment => assignment.Service)
                .WithMany(service => service.UserAssignments)
                .HasForeignKey(assignment => assignment.ServiceId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<ClinicService>(entity =>
        {
            entity.HasAlternateKey(service => new { service.DepartmentId, service.Id });
            entity.Property(service => service.Name).HasMaxLength(100).IsRequired();
            entity.HasIndex(service => new { service.DepartmentId, service.Name }).IsUnique();
            entity.HasOne(service => service.Department)
                .WithMany()
                .HasForeignKey(service => service.DepartmentId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<Station>(entity =>
        {
            entity.HasAlternateKey(station => new { station.DepartmentId, station.Id });
            entity.Property(station => station.Name).HasMaxLength(100).IsRequired();
            entity.HasIndex(station => new { station.DepartmentId, station.Name }).IsUnique();
            entity.HasOne(station => station.Department)
                .WithMany()
                .HasForeignKey(station => station.DepartmentId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<StationService>(entity =>
        {
            entity.HasKey(assignment => new { assignment.DepartmentId, assignment.StationId, assignment.ServiceId });
            entity.HasOne(assignment => assignment.Station)
                .WithMany(station => station.ServiceAssignments)
                .HasForeignKey(assignment => new { assignment.DepartmentId, assignment.StationId })
                .HasPrincipalKey(station => new { station.DepartmentId, station.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(assignment => assignment.Service)
                .WithMany()
                .HasForeignKey(assignment => new { assignment.DepartmentId, assignment.ServiceId })
                .HasPrincipalKey(service => new { service.DepartmentId, service.Id })
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<StationStaff>(entity =>
        {
            entity.HasKey(assignment => new { assignment.DepartmentId, assignment.StationId, assignment.UserId });
            entity.HasOne(assignment => assignment.Station)
                .WithMany(station => station.StaffAssignments)
                .HasForeignKey(assignment => new { assignment.DepartmentId, assignment.StationId })
                .HasPrincipalKey(station => new { station.DepartmentId, station.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(assignment => assignment.UserDepartment)
                .WithMany(userDepartment => userDepartment.StationAssignments)
                .HasForeignKey(assignment => new { assignment.UserId, assignment.DepartmentId })
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<DailySequence>(entity =>
        {
            entity.HasKey(sequence => sequence.ClinicDate);
            entity.Property(sequence => sequence.ClinicDate).HasConversion(ClinicDateConverter).HasColumnType("date");
        });

        builder.Entity<DepartmentSequence>(entity =>
        {
            entity.HasKey(sequence => new { sequence.DepartmentId, sequence.ClinicDate });
            entity.Property(sequence => sequence.ClinicDate).HasConversion(ClinicDateConverter).HasColumnType("date");
            entity.HasOne(sequence => sequence.Department).WithMany()
                .HasForeignKey(sequence => sequence.DepartmentId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<Visit>(entity =>
        {
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_Visits_ExactlyOneIssuer",
                "(`IssuedByUserId` IS NOT NULL AND `IssuedByKioskDeviceId` IS NULL) OR (`IssuedByUserId` IS NULL AND `IssuedByKioskDeviceId` IS NOT NULL)"));
            entity.Property(visit => visit.ClinicDate).HasConversion(ClinicDateConverter).HasColumnType("date");
            entity.Property(visit => visit.VisitCode).HasMaxLength(12).IsRequired();
            entity.Property(visit => visit.ReferenceId).HasMaxLength(50);
            entity.HasIndex(visit => new { visit.ClinicDate, visit.Sequence }).IsUnique();
            entity.HasIndex(visit => new { visit.ClinicDate, visit.ReferenceId });
            entity.HasOne(visit => visit.IssuedBy)
                .WithMany()
                .HasForeignKey(visit => visit.IssuedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(visit => visit.IssuedByKioskDevice)
                .WithMany()
                .HasForeignKey(visit => visit.IssuedByKioskDeviceId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(visit => visit.CurrentStep)
                .WithOne()
                .HasForeignKey<Visit>(visit => new { visit.Id, visit.CurrentStepId })
                .HasPrincipalKey<DepartmentStep>(step => new { step.VisitId, step.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(visit => visit.CurrentStepId).IsUnique();
        });

        builder.Entity<DepartmentStep>(entity =>
        {
            entity.HasAlternateKey(step => new { step.VisitId, step.Id });
            entity.HasOne(step => step.Department)
                .WithMany()
                .HasForeignKey(step => step.DepartmentId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(step => step.Service)
                .WithMany()
                .HasForeignKey(step => new { step.DepartmentId, step.ServiceId })
                .HasPrincipalKey(service => new { service.DepartmentId, service.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(step => new { step.DepartmentId, step.State, step.AppointmentAtUtc, step.EnteredAtUtc });
            entity.Property(step => step.TicketDate).HasConversion(ClinicDateConverter).HasColumnType("date");
            entity.HasIndex(step => new { step.DepartmentId, step.TicketDate, step.DepartmentTicketNumber })
                .HasDatabaseName("UX_DepartmentSteps_DepartmentDateNumber").IsUnique();
            entity.Property(step => step.State).HasConversion<string>().HasMaxLength(20);
            entity.Property(step => step.EnteredAtUtc).HasPrecision(6);
        });

        builder.Entity<IdempotencyRecord>(entity =>
        {
            entity.Property(record => record.Scope).HasMaxLength(120);
            entity.Property(record => record.KeyHash).HasMaxLength(64);
            entity.Property(record => record.RequestHash).HasMaxLength(64);
            entity.Property(record => record.ResponseJson).HasColumnType("text");
            entity.HasIndex(record => new { record.Scope, record.KeyHash }).IsUnique();
        });

        builder.Entity<DisplayDevice>(entity =>
        {
            entity.Property(device => device.Name).HasMaxLength(100).IsRequired();
            entity.Property(device => device.PairingCodeHash).HasMaxLength(64);
            entity.Property(device => device.CredentialHash).HasMaxLength(64);
            entity.HasIndex(device => device.PairingCodeHash).IsUnique();
            entity.HasIndex(device => device.CredentialHash).IsUnique();
            entity.HasOne(device => device.Department)
                .WithMany()
                .HasForeignKey(device => device.DepartmentId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<DisplayVideo>(entity =>
        {
            entity.Property(video => video.Name).HasMaxLength(160).IsRequired();
            entity.Property(video => video.Url).HasMaxLength(2048);
            entity.Property(video => video.StorageKey).HasMaxLength(80);
            entity.Property(video => video.ContentType).HasMaxLength(40).IsRequired();
            entity.HasIndex(video => new { video.CreatedAtUtc, video.Id });
        });

        builder.Entity<KioskDevice>(entity =>
        {
            entity.Property(device => device.Name).HasMaxLength(100).IsRequired();
            entity.Property(device => device.PairingCodeHash).HasMaxLength(64);
            entity.Property(device => device.CredentialHash).HasMaxLength(64);
            entity.HasIndex(device => device.PairingCodeHash).IsUnique();
            entity.HasIndex(device => device.CredentialHash).IsUnique();
        });

        builder.Entity<AuditRecord>(entity =>
        {
            entity.Property(record => record.Action).HasMaxLength(80).IsRequired();
            entity.Property(record => record.TargetType).HasMaxLength(80).IsRequired();
            entity.Property(record => record.SafeDetails).HasMaxLength(500);
            entity.HasOne<KioskDevice>().WithMany().HasForeignKey(record => record.ActorKioskDeviceId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<OutboxMessage>(entity =>
        {
            entity.Property(message => message.Type).HasMaxLength(80).IsRequired();
            entity.HasIndex(message => new { message.PublishedAtUtc, message.CreatedAtUtc });
        });
    }
}

public sealed class QueueUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = "";
    public bool MustChangePassword { get; set; }
    public bool Active { get; set; } = true;
    public ICollection<UserDepartment> DepartmentAssignments { get; } = new List<UserDepartment>();
    public ICollection<UserService> ServiceAssignments { get; } = new List<UserService>();
}

public sealed class Department
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public bool Active { get; set; } = true;
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class UserDepartment
{
    public Guid UserId { get; set; }
    public QueueUser User { get; set; } = null!;
    public Guid DepartmentId { get; set; }
    public Department Department { get; set; } = null!;
    public ICollection<StationStaff> StationAssignments { get; } = new List<StationStaff>();
}

public sealed class UserService
{
    public Guid UserId { get; set; }
    public QueueUser User { get; set; } = null!;
    public Guid ServiceId { get; set; }
    public ClinicService Service { get; set; } = null!;
}

public sealed class ClinicService
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DepartmentId { get; set; }
    public Department Department { get; set; } = null!;
    public string Name { get; set; } = "";
    public bool Active { get; set; } = true;
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public ICollection<UserService> UserAssignments { get; } = new List<UserService>();
}

public sealed class Station
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DepartmentId { get; set; }
    public Department Department { get; set; } = null!;
    public string Name { get; set; } = "";
    public bool Active { get; set; } = true;
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public ICollection<StationService> ServiceAssignments { get; } = new List<StationService>();
    public ICollection<StationStaff> StaffAssignments { get; } = new List<StationStaff>();
}

public sealed class StationService
{
    public Guid DepartmentId { get; set; }
    public Guid StationId { get; set; }
    public Station Station { get; set; } = null!;
    public Guid ServiceId { get; set; }
    public ClinicService Service { get; set; } = null!;
}

public sealed class StationStaff
{
    public Guid DepartmentId { get; set; }
    public Guid StationId { get; set; }
    public Station Station { get; set; } = null!;
    public Guid UserId { get; set; }
    public UserDepartment UserDepartment { get; set; } = null!;
}

public sealed class DailySequence
{
    public DateOnly ClinicDate { get; set; }
    public int LastSequence { get; set; }
}

public sealed class DepartmentSequence
{
    public Guid DepartmentId { get; set; }
    public Department Department { get; set; } = null!;
    public DateOnly ClinicDate { get; set; }
    public int LastSequence { get; set; }
}

public sealed class Visit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateOnly ClinicDate { get; set; }
    public int Sequence { get; set; }
    public string VisitCode { get; set; } = "";
    public string? ReferenceId { get; set; }
    public bool Completed { get; set; }
    public Guid? IssuedByUserId { get; set; }
    public QueueUser? IssuedBy { get; set; }
    public Guid? IssuedByKioskDeviceId { get; set; }
    public KioskDevice? IssuedByKioskDevice { get; set; }
    public DateTimeOffset IssuedAtUtc { get; set; }
    public Guid? CurrentStepId { get; set; }
    public DepartmentStep? CurrentStep { get; set; }
    public ICollection<DepartmentStep> Steps { get; } = new List<DepartmentStep>();
}

public sealed class DepartmentStep
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid VisitId { get; set; }
    public Visit Visit { get; set; } = null!;
    public Guid DepartmentId { get; set; }
    public Department Department { get; set; } = null!;
    public Guid? ServiceId { get; set; }
    public ClinicService? Service { get; set; }
    public DateOnly? TicketDate { get; set; }
    public int? DepartmentTicketNumber { get; set; }
    public DateTimeOffset? AppointmentAtUtc { get; set; }
    public DepartmentStepState State { get; set; }
    public DateTimeOffset EnteredAtUtc { get; set; }
    public DateTimeOffset? CalledAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
}

public sealed class IdempotencyRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Scope { get; set; } = "";
    public string KeyHash { get; set; } = "";
    public string RequestHash { get; set; } = "";
    public Guid ResultId { get; set; }
    public string? ResponseJson { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class DisplayDevice
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public Guid? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public bool Active { get; set; } = true;
    public string? PairingCodeHash { get; set; }
    public DateTimeOffset? PairingExpiresAtUtc { get; set; }
    public string? CredentialHash { get; set; }
    public DateTimeOffset? PairedAtUtc { get; set; }
}

public sealed class DisplayVideo
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string? Url { get; set; }
    public string? StorageKey { get; set; }
    public string ContentType { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class KioskDevice
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public bool Active { get; set; } = true;
    public string? PairingCodeHash { get; set; }
    public DateTimeOffset? PairingExpiresAtUtc { get; set; }
    public string? CredentialHash { get; set; }
    public DateTimeOffset? PairedAtUtc { get; set; }
}

public sealed class AuditRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? ActorUserId { get; set; }
    public Guid? ActorKioskDeviceId { get; set; }
    public string Action { get; set; } = "";
    public string TargetType { get; set; } = "";
    public Guid TargetId { get; set; }
    public DateTimeOffset OccurredAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public string CorrelationId { get; set; } = "";
    public string? SafeDetails { get; set; }
}

public sealed class OutboxMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Type { get; set; } = "";
    public Guid AggregateId { get; set; }
    public Guid DepartmentId { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? PublishedAtUtc { get; set; }
}
