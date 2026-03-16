using FluentValidation;
using MediatR;
using ConveyMate.Api.Application.Configuration.EnabledStates;
using ConveyMate.Api.Application.Users;
using ConveyMate.Api.Application.Users.Abstractions;

namespace ConveyMate.Api.Application;

/// <summary>
/// Registers application-layer use-case services, MediatR handlers, and validation pipeline behaviors.
/// </summary>
public static class ApplicationServiceCollectionExtensions
{
    public static IServiceCollection AddApplicationLayer(this IServiceCollection services)
    {
        services.AddMediatR(typeof(CurrentUserAccessor).Assembly);

        services.AddValidatorsFromAssemblyContaining<CurrentUserAccessor>();
        services.AddScoped(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));

        services.Scan(scan => scan
            .FromAssemblyOf<CurrentUserAccessor>()
            .AddClasses(classes => classes.AssignableTo<ICurrentUserAccessor>())
            .AsImplementedInterfaces()
            .WithScopedLifetime()
            .AddClasses(classes => classes.AssignableTo<IEnabledStatesProvider>())
            .AsImplementedInterfaces()
            .WithSingletonLifetime());

        return services;
    }
}
