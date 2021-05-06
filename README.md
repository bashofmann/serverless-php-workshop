# DPC Serverless Workshop

In the second part of the workshop we'll add a repository that uses Amazon DynamoDB to store data about our payments

## Examine the changes to our application

## Key DynamoDB principles

## Implement the repository with DynamoDB

Implement the required functions into `DynamoPaymentRepository.php`

```
public function findPayment(string $id): Payment{
  $params = DynamoUtils::findParams(Payment::class, $id);

  $result = $this->client->query($params);
  $items = $result->get('Items');

  if (count($items)===0){
    throw new PaymentNotFoundException("The payment with ID $id could not be found");
  }

  $item = reset($items);

  return Payment::hydrate($item);
}

public function putPayment(Payment $payment): void{
  $item_params = DynamoUtils::insertParams($payment);

  $this->client->putItem($item_params);
}
```

Add the DynamoClient to `dependencies.php`

```
DynamoDbClient::class => function(){
    $args = [
      'region' => Env::getAwsRegion(),
      'version' => 'latest',
    ];
    # Add in local test code here

    $sdk = new Sdk($args);

    return $sdk->createDynamoDb();
  }
```

Explore `DynamoUtils.php`

Explore the payment entity `Payment.php` and the hydrator `EntityHydrate.php`

## Testing Dynamo locally

Inspect `docker-compose.yml`

`docker/dynamo/Dockerfile`

```
RUN nohup bash -c "java -Djava.library.path=/usr/lib/DynamoDBLocal_lib -jar /usr/lib/DynamoDBLocal.jar -port 8002 -sharedDb  -dbPath /var/lib/dynamodb &" && \
      echo "Dynamo starting, will wait 2s" && \
      sleep 2 && \
      AWS_ACCESS_KEY_ID=key AWS_SECRET_ACCESS_KEY=secret aws --region us-east-1 dynamodb --endpoint-url http://127.0.0.1:8002 create-table --table-name='serverless-payments' --key-schema 'AttributeName=id,KeyType=HASH' --attribute-definitions 'AttributeName=id,AttributeType=S' --provisioned-throughput='ReadCapacityUnits=1,WriteCapacityUnits=1'
```

Add test endpoint code to `dependencies.php`

```
$endpoint = Env::getDynamoEndpoint();
if ($endpoint){
  $args['endpoint'] = $endpoint;
  $args['credentials'] = [
    'key' => 'abc',
    'secret' => 'abc',
  ];
}
```

## Add new routes to utilise DynamoDB 
