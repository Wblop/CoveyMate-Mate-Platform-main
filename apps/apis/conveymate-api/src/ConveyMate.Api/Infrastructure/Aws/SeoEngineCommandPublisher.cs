using Amazon.SQS;
using Amazon.SQS.Model;
using Microsoft.Extensions.Options;
using ConveyMate.Api.Application.SeoEngine.Abstractions;
using ConveyMate.Api.Configuration;

namespace ConveyMate.Api.Infrastructure.Aws;

public sealed class SeoEngineCommandPublisher(
    IAmazonSQS sqsClient,
    IOptions<SeoEngineAutomationOptions> seoEngineOptions)
    : ISeoEngineCommandPublisher
{
    public async Task PublishAsync(string messageBody, CancellationToken cancellationToken)
    {
        var queueUrl = seoEngineOptions.Value.CommandQueueUrl?.Trim();
        if (string.IsNullOrWhiteSpace(queueUrl))
        {
            throw new InvalidOperationException(
                "SEO Engine queue is not configured. Set SeoEngineAutomation:CommandQueueUrl or the matching SSM parameter.");
        }

        await sqsClient.SendMessageAsync(
            new SendMessageRequest
            {
                QueueUrl = queueUrl,
                MessageBody = messageBody
            },
            cancellationToken);
    }
}
