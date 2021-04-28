<?php
declare(strict_types=1);

namespace App\Application\Actions\Payments;

use App\Application\Actions\Action;
use App\Domain\Payment\PaymentRepository;
use Psr\Log\LoggerInterface;

abstract class PaymentAction extends Action {

	public function __construct(LoggerInterface $logger){
		parent::__construct($logger);
	}
}
