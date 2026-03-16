namespace ConveyMate.Api.Application.SeoEngine.Abstractions;

public interface ISeoEngineCommandPublisher
{
    Task PublishAsync(string messageBody, CancellationToken cancellationToken);
}
