using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Queuing.Api.Auth;
using Queuing.Api.Data;
using Queuing.Api.Hubs;
using Queuing.Api.Services;

var bootstrapAdmin = args.Contains("--bootstrap-admin", StringComparer.Ordinal);
var appArgs = args.Where(argument => !string.Equals(argument, "--bootstrap-admin", StringComparison.Ordinal)).ToArray();
var builder = WebApplication.CreateBuilder(appArgs);

var connectionString = builder.Configuration.GetConnectionString("Queueing");
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException("Configure ConnectionStrings:Queueing before starting the clinic queue API.");
}

builder.Services.AddDbContext<QueueDbContext>(options => options.UseMySQL(connectionString));
builder.Services.AddIdentity<QueueUser, IdentityRole<Guid>>(options =>
    {
        options.User.RequireUniqueEmail = false;
        options.Password.RequiredLength = 12;
        options.Password.RequireDigit = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireNonAlphanumeric = true;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    })
    .AddEntityFrameworkStores<QueueDbContext>()
    .AddDefaultTokenProviders();
builder.Services.Configure<SecurityStampValidatorOptions>(options => options.ValidationInterval = TimeSpan.Zero);
builder.Services.AddScoped<IUserClaimsPrincipalFactory<QueueUser>, QueueUserClaimsPrincipalFactory>();

builder.Services.ConfigureApplicationCookie(options =>
{
    options.Cookie.Name = "Queuing.Auth";
    options.Cookie.HttpOnly = true;
    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.ExpireTimeSpan = TimeSpan.FromHours(8);
    options.SlidingExpiration = true;
    options.Events.OnRedirectToLogin = context =>
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    };
    options.Events.OnRedirectToAccessDenied = context =>
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    };
});

builder.Services.AddAuthentication()
    .AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions, DisplayDeviceAuthHandler>(
        DisplayDeviceAuthHandler.SchemeName, _ => { })
    .AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions, KioskDeviceAuthHandler>(
        KioskDeviceAuthHandler.SchemeName, _ => { });
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(QueueRoles.Admin, policy => policy.RequireRole(QueueRoles.Admin).RequireClaim("must_change_password", "false"));
    options.AddPolicy(QueueRoles.Reception, policy => policy.RequireRole(QueueRoles.Reception, QueueRoles.Admin).RequireClaim("must_change_password", "false"));
    options.AddPolicy(QueueRoles.Staff, policy => policy.RequireRole(QueueRoles.Staff, QueueRoles.Admin).RequireClaim("must_change_password", "false"));
    options.AddPolicy(QueueRoles.QueueServices, policy => policy.RequireRole(QueueRoles.Admin, QueueRoles.Reception, QueueRoles.Staff).RequireClaim("must_change_password", "false"));
    options.AddPolicy("DisplayDevice", policy => policy
        .AddAuthenticationSchemes(DisplayDeviceAuthHandler.SchemeName)
        .RequireAuthenticatedUser());
    options.AddPolicy(QueueRoles.KioskDevicePolicy, policy => policy
        .AddAuthenticationSchemes(KioskDeviceAuthHandler.SchemeName)
        .RequireAuthenticatedUser());
});
builder.Services.AddAntiforgery(options => options.HeaderName = "X-CSRF-TOKEN");
builder.Services.AddControllersWithViews(options => options.Filters.Add(new AutoValidateAntiforgeryTokenAttribute()));
builder.Services.AddProblemDetails();
builder.Services.AddSignalR();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("login", httpContext => RateLimitPartition.GetFixedWindowLimiter(
        httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
    options.AddPolicy("pairing", httpContext => RateLimitPartition.GetFixedWindowLimiter(
        httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
    options.AddPolicy("kiosk-issue", httpContext => RateLimitPartition.GetFixedWindowLimiter(
        httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
});
builder.Services.AddHealthChecks().AddCheck<QueueDatabaseHealthCheck>("mysql");
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<VisitIssuanceService>();
builder.Services.AddHostedService<QueueOutboxDispatcher>();

var app = builder.Build();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseRateLimiter();
app.UseAuthentication();
app.Use(async (context, next) =>
{
    if (LocalSetupAccess.IsAdminApiPath(context.Request.Path) &&
        context.User.Identity?.IsAuthenticated != true &&
        LocalSetupAccess.IsAllowed(
            app.Configuration.GetValue<bool>("LocalSetup:Enabled"),
            app.Environment.EnvironmentName,
            context.Connection.RemoteIpAddress,
            context.Request.Host.Host))
    {
        context.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim(ClaimTypes.Name, "Local setup"),
            new Claim(ClaimTypes.Role, QueueRoles.Admin),
            new Claim("must_change_password", "false")
        ]));
    }

    await next(context);
});
app.UseAuthorization();
app.MapControllers();
app.MapHub<QueueHub>("/hubs/displays");
app.MapHealthChecks("/health/ready");
app.MapGet("/health/live", () => Results.Ok(new { status = "ok" }));

if (bootstrapAdmin)
{
    await AdminBootstrapper.RunAsync(app.Services, app.Configuration);
    return;
}

await using (var migrationScope = app.Services.CreateAsyncScope())
{
    var db = migrationScope.ServiceProvider.GetRequiredService<QueueDbContext>();
    await db.Database.MigrateAsync();
}

await app.RunAsync();

public partial class Program;
