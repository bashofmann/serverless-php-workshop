# Serverless Workshop

The final step of our application is to handle asynchronous events, in this case using SQS, Amazon's queue service. We'll hook this up to be processed by our application using Lambda

## Creating a webhook storage mechanism

SQS is a queue service that exposes a simple HTTP endpoint. Depending
on permissions of a queue any HTTP service can post to the queue.
However to do this, the data sent to the queue must meet the
required format of the queue, so collecting simply any HTTP request
with a JSON body isn't possible.

Most services that send webhooks will do something simple like retry
(possibly with exponential back-off) for webhooks that receive a 4xx
or 5xx HTTP status code. But most won't do anything beyond this, and many
will eventually give up. Unlike more intelligent API consumers (e.g. a
front end application, or a custom 3rd party implementation) sending an
error message will be fairly pointless - most likely we, as developers
of the webhook receiver, will need to handle this.

With a considerable amount of YAML we can create a service that exposes
an API gateway endpoint that provides a simple proxy, speaking the
required language of the queue so that any JSON request sent to the
endpoint will be placed on the queue.

```
    # This is where webhooks will be saved
    WebhookQueue:
      Type: AWS::SQS::Queue
      Properties:
        VisibilityTimeout: 20
        MessageRetentionPeriod: 604800
        RedrivePolicy:
          deadLetterTargetArn: !GetAtt [ WebhookDeadLetterQueue, Arn ]
          maxReceiveCount: 1
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
curl -X POST -d '{"test": 1}' <output-url>/development
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

This file has been created to do the basic work of bootstrapping our Slim
framework application. However unlike our `index.php` file which executes
Slim just like any other web-hosted setup would, this function is
executed as a Lambda event. What this means is that when Bref runs this
function in response to an event sent to Lambda, it executes our
bootstrap and expects to receive a callable returned from the script.

The current behaviour is very basic - we log to CloudWatch and we exit.
We can add to our `serverles.yml` file to create the function:

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
          arn: !GetAtt WebhookQueue.Arn
```

If we deploy this function and post to the queue we should see the item
processed in CloudWatch logs:

```
curl -X POST -d '{"test": 1}' <output-url>
```

One advantage of processing webhooks this way, rather than via another
web endpoint, is that we can handle processing failures natively within
the infrastructure, rather than having to manage them in our application.

For this reason, in our YML block above we created a "dead letter queue"
which handles "failed" queue processing. The way this works is that if
the function throws an exception (i.e. some internal code throws and we
do not catch it) Lambda will return our SQS message to the queue. Each
time an SQS message is returned to the queue SQS will check the "redrive
policy". In our case we've said that if the message is received by a
consumer once, the next time it returns to the queue it will drop into
the "dead-letter queue".

We can simulate this by adding the following:

```
throw new \Exception('This always throws, oops');
```

Now post to the queue, and we will see 1 invocation, followed by a
message becoming visible in our dead-letter queue.

At present handling of dead-letter queues needs to be manual - this is
because presumably the repeated failure means something is wrong with our
code, rather than just a tempoary service outage. So likely it needs a
developer to intervene.

The Bref team are working at present on a dashboard to monitor Bref
functions - one feature they plan to add, which is not native to the AWS
console, is the ability to easily pivot from viewing a dead-letter queue
message, to see the logs for that message's original invocation, and a
one-click option to retry (presumably once we've determined that it will
not fail again, should we do so).

## Working code

Now that we've tested this, we can apply the actual useful code for our
application to the webhook (overwriting the current function content).
This lets us count the number of payments received against our
particular payment request. We could also use this to add users to a
list for dispatch or tickets if we were running an event - or use a tool
like AWS Simple Email Service to send a confirmation email.

```
$record = reset($event['Records']);
$data = json_decode($record['body'], true, 512, JSON_THROW_ON_ERROR);

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

If we now deploy and make a payment we should be able to go into the
DynamoDB console and see the count has ticked up - and if somehow we miss
the webhook from Stripe,
we will see it in our dead-letter queue to allow us to debug our application,
and not lose out on any important data for our business.
