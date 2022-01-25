# Serverless Workshop

In the second part of the workshop we'll add a repository that uses Amazon DynamoDB to store data about our payments

## Examine the changes to our application

Check out the `PaymentRepository.php` and `Payment.php` classes.

Examine how payments are now split between two actions:

* `SetupPaymentAction.php` this takes the inputs from the first stage
  of our application and creates the payment request with a unique ID in
  DynamoDB
* `StartPaymentAction.php` does as previously and creates the payment with
  Stripe. However it loads the amount and description from DynamoDB in
  order to guarantee that users make the expected payment.
  
Also this application, adding persistence, allows generation of a
link back to a pre-set payment request. This is implemented with another
new action:

* `FetchPaymentAction.php` this takes in an ID and fetches the record
  from DynamoDB

## Key DynamoDB principles

DynamoDB is a serverless key-value store, with a set of advanced
features built on top:

**Keys**

* By default its "key" is a composite of two distinct keys: a hash
  key, and a range key. Every table must have a hash key, but a range
  key is optional
* The composite of "hash" and "range" keys for a given record must be
  unique in the table. Dynamo does not have separate "insert" and
  "update" commands. So an attempt to add a record with a key that
  already exists will overwrite that record.
* DynamoDB can only be queried by specifying a key. A hash key must be
  specified as a direct match, whereas a range key can be specified based
  on a number of conditions, such as greater than, less than or (for
  strings only) "starts with"
  
In the application we are going to build, we will use just a hash key,
and use a GUID for this. This means quick lookups with the GUID, but
more (potentially) expensive table scans would be needed to find records
if one did not have a GUID to look up.

**Documents**

Whilst DDB is a key-value store, the format of the value is a custom
document format based around JSON. The document contains the fields designated hash and range key, as well as any other fields a user
wishes to include (there is no schema).

Unlike regular JSON, DynamoDB documents have a wider range of data types,
such as binary data or sets which guarantee all data within is of the
same fixed type.

Because of the wider range of types, documents sent to DynamoDB must be
converted from simple JSON to a format where the data type is described
within a custom JSON document. The process is described as "marshalling"

For a full list of data types, see here:
https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html#HowItWorks.DataTypes

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

## Deploying a Dynamo table to AWS

As with our S3 bucket and CloudFront CDN, we can deploy the resource
using CloudFormation syntax in the `serverless.yml` file

```
    Dynamo:
      Type: AWS::DynamoDB::Table
      Properties:
        AttributeDefinitions:
          -
            AttributeName: "id"
            AttributeType: "S"
        KeySchema:
          -
            AttributeName: "id"
            KeyType: "HASH"
        BillingMode: 'PAY_PER_REQUEST'
        # Might be worth setting this from an Env var
        TableName: ${env:DYNAMO_TABLE}
```

To allow the Lambda function to access the Dynamo table we need to
utilise AWS' Identity and Access Management service. This deserves
a workshop of its own to really go into detail, but we can apply
a simple IAM policy that applies to all functions we might declare in
our serverless configuration. This block should be added to the
`provider` block in the `serverless.yml` file

```
  iam:
    role:
      statements: # permissions for all of your functions can be set here
        - Effect: Allow
          Action: # Gives permission to DynamoDB tables in a specific region
            - dynamodb:DescribeTable
            - dynamodb:Query
            - dynamodb:Scan
            - dynamodb:GetItem
            - dynamodb:PutItem
            - dynamodb:UpdateItem
            - dynamodb:DeleteItem
          Resource: 'arn:aws:dynamodb:${env:AWS_REGION}:*:table/${env:DYNAMO_TABLE}'
```

Now that we have permissioned our function and created a table, we
can run our application live.

Once we have set up a payment we can open the AWS console to inspect
the content of the table.

## (time dependent) More features of DynamoDB

* Local Secondary Indexes: these allow a different range key to be used
  whilst keeping the same hash key. They must be specified at table
  creation and cannot be added once data is in the table.
* Global Secondary Indexes: a feature that pushes DDB beyond a basic
  key-value store; any field (or two fields) can be designated as a
  hash/range key for a GSI. Keys can overlap, i.e. a field which is
  a range key for the primary index may be a hash key for a global
  secondary index. GSIs can be added at any time, though adding it to
  a large table might be costly as the table must be written out
  with the new index.
* Time-to-live: any field containing numeric timestamps may be designated
  as a TTL field. DDB will expire documents from the table when the time
  passes this timestamp (it isn't instant, but generally within minutes)
* Streams: DynamoDB can produce a stream of table events - inserts,
  updates, deletes, or a selection of these. A stream can be connected
  to from an external API, or plugged into other AWS services such as
  Kinesis, or Lambda.
