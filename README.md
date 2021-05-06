# DPC Serverless Workshop

The final step of our application is to handle asynchronous events, in this case using SQS, Amazon's queue service. We'll hook this up to be processed by our application using Lambda

## Creating a webhook storage mechanism

SQS is a queue service that exposes a simple HTTP endpoint. Depending
on permissions of a queue any HTTP service can post to the queue.
However to do this, the data sent to the queue must meet the
required format of the queue, so collecting simply any HTTP request
with a JSON body isn't possible.

With a considerable amount of YAML we can create a service that exposes
an API gateway endpoint that provides a simple proxy, speaking the
required language of the queue so that any JSON request sent to the
endpoint will be placed on the queue.

```
    # This is where webhooks will be saved
    WebhookQueue:
      Type: AWS::SQS::Queue
      Properties:
        VisibilityTimeout: 600
        MessageRetentionPeriod: 604800
        ReceiveMessageWaitTimeSeconds: 20
        RedrivePolicy:
          deadLetterTargetArn: !GetAtt [ WebhookDeadLetterQueue, Arn ]
          maxReceiveCount: 5
    WebhookDeadLetterQueue:
      Type: AWS::SQS::Queue
      Properties:
        MessageRetentionPeriod: 1209600
    # The next list all
    WebhookHttpApi:
      Type: AWS::ApiGatewayV2::Api
      Properties:
        ProtocolType: HTTP
        DisableExecuteApiEndpoint: false
        Name: ${opt:stage}-payment-webhooks
    WebhookHttpApiRole:
      Type: AWS::IAM::Role
      Properties:
        AssumeRolePolicyDocument:
          Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Principal:
                Service: apigateway.amazonaws.com
              Action: sts:AssumeRole
        Policies:
          - PolicyName: ApiWriteToSQS
            PolicyDocument:
              Version: '2012-10-17'
              Statement:
                Action: sqs:SendMessage
                Effect: Allow
                Resource: !GetAtt WebhookQueue.Arn
    WebhookPayloadRoute:
      Type: AWS::ApiGatewayV2::Route
      Properties:
        ApiId: !Ref WebhookHttpApi
        RouteKey: POST /
        Target: !Sub 'integrations/${WebhookRouteIntegration}'
    WebhookRouteIntegration:
      Type: AWS::ApiGatewayV2::Integration
      Properties:
        ApiId: !Ref WebhookHttpApi
        Description: Proxy incoming HTTP Payload into Webhook SQS
        IntegrationType: AWS_PROXY
        IntegrationSubtype: SQS-SendMessage
        PayloadFormatVersion: '1.0'
        CredentialsArn: !GetAtt WebhookHttpApiRole.Arn
        RequestParameters:
          QueueUrl: !Ref WebhookQueue
          MessageBody: $request.body # Send the body of the HTTP request into SQS
    WehookStage:
      Type: AWS::ApiGatewayV2::Stage
      Properties:
        AutoDeploy: true
        StageName: ${opt:stage}
        ApiId: !Ref WebhookHttpApi
```

Add `Outputs`

```
    WebhookURI:
      Description: The URI that webhooks should be sent to
      Value: !GetAtt WebhookHttpApi.ApiEndpoint
```

Once these items have been added to `serverless.yml` we can try posting
some data to our queue:

```
curl -X POST -d '{"test": 1}' {output-url}
```

Now in the AWS console we can see our queue, and "poll" it for messages.
A queue isn't a data storage solution; it is not possible to examine the
data in it without affecting the queue. Queues are generally designed so
that only one consumer can see a message at a given time, so "polling" a
queue will cause items that we can see in our poll to be unavailable to
other consumers for a short time. So polling a live queue will
temporarily delay messages being delivered to other consumers.

Once we have items in our queue, we can hook up a Lambda function to
process them as they arrive. Lambda will manage concurrent function
invocations so that as more items add to the queue, there are never
too many at any one time waiting to be processed.

## Making an event Lambda with Bref

Firstly we want to look at `webhook.php`, the example function created
to process our event Lambda.



```
$record = reset($event['Records']);
$data = json_decode($record['body'], true, JSON_THROW_ON_ERROR);

$logger->debug('Received webhook from queue', [
  '_webhook' => $data,
  '_lambda' => $context->jsonSerialize(),
]);

Stripe::setApiKey(Env::getStripeKey());

$payment_intent_id = $data['data']['object']['payment_intent'];

$payment_intent = PaymentIntent::retrieve($payment_intent_id);

$payment_id = $payment_intent->metadata['id'];

$payments = $container->get(PaymentRepository::class);

$payment = $payments->findPayment($payment_id);

$payment->incrementPaid();

$payments->putPayment($payment);

$logger->notice("Updated payment", [
  'id' => $payment_id,
  'payment_intent' => $payment_intent_id,
]);
```

```
  webhook:
    handler: webhook.php
    layers:
      - ${bref:layer.php-74}
    events:
      - sqs:
          # We only want to process 1 at a time
          # so if it fails we can retry
          batchSize: 1
          arn:
            Fn::GetAtt:
              - WebhookQueue
              - Arn
```
