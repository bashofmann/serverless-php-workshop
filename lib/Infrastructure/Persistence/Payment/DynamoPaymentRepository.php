<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence\Payment;

use App\Domain\Payment\Payment;
use App\Domain\Payment\PaymentNotFoundException;
use App\Domain\Payment\PaymentRepository;
use App\Infrastructure\Persistence\DynamoUtils;
use Aws\DynamoDb\DynamoDbClient;

class DynamoPaymentRepository implements PaymentRepository {

	private DynamoDbClient $client;

	public function __construct(DynamoDbClient $client){
		$this->client = $client;
	}

}
