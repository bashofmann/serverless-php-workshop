<?php

namespace App\Application\Actions\Payments;

use App\Application\Settings\Env;
use Psr\Http\Message\ResponseInterface as Response;
use Stripe\PaymentIntent;
use Stripe\Stripe;

class SetupPaymentAction extends PaymentAction {

	protected function action(): Response{
		// retrieve JSON from POST body
		$data = $this->getFormData();

		// Amount will be in decimal e.g. £5.54
		$amount = $data->amount;
		$description = $data->description;

		Stripe::setApiKey(Env::getStripeKey());

		$payment = [
			'amount' => $amount,
			'currency' => Env::getCurrency(),
			'description' => $description,
		];
		$payment_intent = PaymentIntent::create($payment);

		// replace this with just the Payment entity return
		$output = array_merge($payment, [
			'clientSecret' => $payment_intent->client_secret,
		]);

		return $this->respondWithData($output);
	}
}
