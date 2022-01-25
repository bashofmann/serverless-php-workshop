# Serverless Workshop

## Testing the application locally

* We start this project with a working application - the basics of
  building a web application with API back-end and React front-end
  are not part of this workshop.
* The front-end is a simple React application set up using "create React
  app" and Tailwind. When the app loads in a browser it provides an
  interface to add a charge value and desccription; on submission it
  communicates with an API to create a "payment intent" using Stripe
* The back end is written in the Slim framework and provides one simple
  route to create the payment intent using our private key with Stripe
* In the first step this is the only back end interaction; the rest of
  the process is carried out direct with Stripe from the browser

We can run the application locally with:

* docker
* docker-compose
* node >=12

Before running we need to configure a local environment by copying
`.env.sample` to `.env.development.local`. At this stage of local
development there shouldn't be anything that needs changing, but 
you can add your own Stripe test keys if you have an account.

(NB: I'll be using `nvm` to manage node versions, so typing `nvm use`
before any node commands will be necessary for each new terminal)

```
docker-compose run composer composer install
npm i
docker-compose up -d web
npm run start
```

At this point the website should be accessible at
`http://localhost:3000/`. To test the API we can run 
`curl -I http://localhost:8080/api/` to which we should see a 204
no content response.

On the website itself we should be able to make a payment by
following the form inputs.

So far, so normal. This helps us see that a basic serverless application
doesn't have to be dramatically different to one we could run on a VPS
or container hosting service.

## Examining the application

It does turn out that we've had to make some changes to the basic
application created by the Slim template. We'll look over some of them
- they don't change the behaviour much locally, but they are necessary
to run on Bref via Lambda
  
* `index.php` (line 12) this file was originally in `app/` but has been
  moved to the root, as Bref expects to point requests (via php-fpm) to
  such a file, as might be found in any other application
* `index.php` (line 19) the cache directory has been changed to `/tmp`;
  when running in a container on Lambda the file system is read-only
  except for `/tmp`. Anything saved to this directory, as the name
  suggests, is temporary. Files here may persist between multiple
  invocations of the Lambda function within a short window but this
  should not be relied upon except for caching.
* `middleware.php` (line 7) the session middleware has been removed
  from the application. Whilst leaving it would not cause a problem,
  it could create confusion whilst working on the application. Sessions
  do not natively work due to lack of persistent file storage. It would
  be possible to use a separate storage for sessions, such as a Redis
  server or DynamoDB. However there is benefit for a Serverless
  application being built stateless, using a technique such as JSON web
  tokens.
* `settings.php` (line 20) the default logging path has been adjusted to
  write out to STDERR; this will cause log lines to be written to
  CloudWatch, Amazon's logging service
  
These are all the changes made for now; it's time to explore how we deploy
the application to Lambda.

## Deploying an API to Amazon Lambda

The deployment to Lambda is controlled by `serverless.yml` and requires
the Serverless framework to be installed locally with:

```
npm install -g serverless
```

The yml file defines some basic configuration, name, environment
variables; hopefully most of this is relatively easy to read.

The key section is `functions`, where each named key (we called ours
"api") defines a function that will be deployed to Lambda. We're using
the Bref defaults, with their php-fpm 7.4 container, and configuring
the API in "proxy" mode, where any given path will call this
function.

Once again before running we need to set up an environment, copy
`.env.sample` to `.env.development`. Most values can be the same as
local; the `REACT_APP_API_URL` will need to change _after_ we deploy
the API, because until then we won't have a URL.

To deploy you will need AWS credentials configured in
`~/.aws/credentials` or imported into your environment manually or
using a tool like `aws-vault`. Then run:

```
serverless deploy --stage=development
```

The stage is useful to deploy different versions to one account, such
as development, staging, production. It also relates to the specific
`.env` file that will be used in the format `.env.{stage}`

The deploy will package up the application, create a custom S3 bucket
and provide an endpoint (you might need to scroll up slightly)

```
endpoints:
  ANY - https://{some random string}.execute-api.eu-west-1.amazonaws.com
```

We can make a quick `curl` request (remembering to add our path `/api/`)
to check it works.

## Deploying a front-end to S3 and Cloudfront

To deploy our front end we want to use an S3 bucket. S3 has native
website hosting capabilities, meaning we can create a bucket and upload
our static content generated by React.

Unfortunately there's one catch - S3 website hosting is http only,
and for an application taking payments that won't cut it - we need our
serving to be done via HTTPS. This requires one other AWS service, the
CDN called CloudFront. A CloudFront distribution not only allows static
content to be served via HTTPS, but also handles caching it worldwide,
speeding asset delivery times.

The `serverless.yml` file can tap into AWS' native infrastructure-as-code
platform CloudFormation by adding a `resources` key; anything in this
section works the same as any other CloudFormation examples you might
find. The below block will create the necessary S3 bucket and distribution. To save having to remember multiple URLs we will also
use this to route API requests to API Gateway.

```
resources:
  Outputs:
    CloudfrontURL:
      Description: The URL our application runs at
      Value: !GetAtt WebsiteCDN.DomainName
    DistributionId:
      Description: The ID to create invalidations at
      Value: !Ref WebsiteCDN
  Resources:
    # The S3 bucket that stores the assets
    Website:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: ${env:BUCKET_FRONT_END}
    # The policy that makes the bucket publicly readable
    WebsiteBucketPolicy:
      Type: AWS::S3::BucketPolicy
      Properties:
        Bucket: !Ref Website # References the bucket we defined above
        PolicyDocument:
          Statement:
            -   Effect: Allow
                Principal: '*' # everyone
                Action: 's3:GetObject' # to read
                Resource: !Join ['/', [!GetAtt Website.Arn, '*']] # things in the bucket
              # alternatively you can write out Resource: 'arn:aws:s3:::<bucket-name>/*'
    WebsiteCDN:
      Type: AWS::CloudFront::Distribution
      Properties:
        DistributionConfig:
          Enabled: true
          # Cheapest option by default (https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_DistributionConfig.html)
          PriceClass: PriceClass_100
          # Enable http2 transfer for better performances
          HttpVersion: http2
          DefaultRootObject: 'index.html'
          # Origins are where CloudFront fetches content
          Origins:
            # The front end (S3)
            -   Id: Website
                DomainName: !GetAtt Website.RegionalDomainName
                S3OriginConfig: {} # this key is required to tell CloudFront that this is an S3 origin, even though nothing is configured
            # The API (AWS Lambda)
            -   Id: Api
                DomainName: !Join ['.', [!Ref HttpApi, 'execute-api', !Ref AWS::Region, 'amazonaws.com']]
                CustomOriginConfig:
                  OriginProtocolPolicy: 'https-only' # API Gateway only supports HTTPS
          # The default behaviour is for the S3 bucket holding static
          # website assets
          DefaultCacheBehavior:
            AllowedMethods: [GET, HEAD]
            TargetOriginId: Website
            MinTTL: 0
            DefaultTTL: 300
            MaxTTL: 300
            ForwardedValues:
              QueryString: 'false'
              Cookies:
                Forward: none
            ViewerProtocolPolicy: redirect-to-https
            Compress: true # Serve files with gzip for browsers that support it (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html)
          CacheBehaviors:
            -   PathPattern: '/api/*'
                TargetOriginId: Api
                AllowedMethods: [GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE]
                # We don't want to cache API activity, though we could be more
                # specific if we had some (e.g. GET) endpoints that were cacheable
                DefaultTTL: 0
                MinTTL: 0
                MaxTTL: 0
                # https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cloudfront-distribution-forwardedvalues.html
                ForwardedValues:
                  QueryString: true
                  Cookies:
                    Forward: all # Forward cookies to use them in PHP
                  # We must *not* forward the `Host` header else it messes up API Gateway
                  Headers:
                    - 'Accept'
                    - 'Accept-Encoding'
                    - 'Accept-Language'
                    - 'Authorization'
                    - 'Content-type'
                    - 'Origin'
                    - 'Referer'
                # CloudFront will force HTTPS on visitors (which is more secure)
                ViewerProtocolPolicy: redirect-to-https
          CustomErrorResponses:
            # Force CloudFront to not cache HTTP errors
            -   ErrorCode: 500
                ErrorCachingMinTTL: 0
            -   ErrorCode: 504
                ErrorCachingMinTTL: 0
```

Once this code has been added we can re-run the serverless deploy - even
though our app content has not changed, we create more resources this
time. Before we do we need to choose a value for the `BUCKET_FRONT_END`
environment variable.

To both build our app and deploy it we can use a pre-built helper
saved in `bin/deploy-dev-front`


## (time-dependent) Invalidations for Cloudfront

React uses custom hashes in file names to ensure that files
can be cached with a long lifetime but new updates are still fetched.

The one file that _can't_ follow this pattern is the index.html file,
because ultimately that needs to point to the other resources.

CloudFront allows an "invalidation" which resets the cache for a given file. These are limited to 1000 per month before they incur a small
cost, but this still affords many invalidations per day.

To avoid the complexity of carrying these out manually, this can be appended to the `bin/deploy-dev-front` script to invalidate the
`index.html` file with each deploy:

```
DISTRIBUTION_ID=$(node -p "require('./serverless-output.json').DistributionId")

echo "Distribution ID: $DISTRIBUTION_ID"

aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/index.html" --output text
```

To get the Distribution ID here we need our serverless deploys to output
some data in a way that other applications can easily read. Append this
after the `vendor/bref/bref` line in `serverless.yml`:

```
  - serverless-export-outputs

custom:
  exportOutputs:
    include:
      - DistributionId
    output:
      file: ./serverless-output.json # file path and name relative to root
      format: json # toml, yaml/yml, json
```

(NB whitespace matters given this is a yml file)
