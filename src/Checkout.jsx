import React, {useState} from "react";
import {
	CardElement,
	useStripe,
	useElements
} from "@stripe/react-stripe-js";

export default function CheckoutForm({ id, setId }){
	const [succeeded, setSucceeded] = useState(false);
	const [error, setError] = useState(null);
	const [processing, setProcessing] = useState('');
	const [disabled, setDisabled] = useState(true);
	const [name, setName] = useState(null);
	const [email, setEmail] = useState(null);
	const stripe = useStripe();
	const elements = useElements();

	const cardStyle = {
		style: {
			base: {
				color: "#32325d",
				fontFamily: 'Arial, sans-serif',
				fontSmoothing: "antialiased",
				fontSize: "16px",
				"::placeholder": {
					color: "#32325d"
				}
			},
			invalid: {
				color: "#fa755a",
				iconColor: "#fa755a"
			}
		}
	};

	const handleChange = async (event) => {
		// Listen for changes in the CardElement
		// and display any errors as the customer types their card details
		setDisabled(event.empty);
		setError(event.error ? event.error.message : "");
	};

	const handleSubmit = async ev => {
		ev.preventDefault();
		setProcessing(true);

		const payload = await stripe.confirmCardPayment(id, {
			payment_method: {
				card: elements.getElement(CardElement),
				billing_details: {
					name,
					email,
				},
			},
			receipt_email: email,
		});

		if (payload.error){
			setError(`Payment failed ${payload.error.message}`);
			setProcessing(false);
		}
		else {
			setError(null);
			setProcessing(false);
			setSucceeded(true);
		}
	};

	const reset = () => {
		setId(null)
	}

	const changeName = ev => {
		setName(ev.target.value)
	}

	const changeEmail = ev => {
		const { target } = ev
		setEmail(target.validity.valid ? target.value : null)
	}

	return (
		<div className="container-shadow">
			<h2 className="form-title">{succeeded ? 'Thanks for your custom' : 'Complete the payment'}</h2>
			{succeeded ? <p className="mt-2 p-2 bg-green-600 text-white text-center">
					{`Your payment is complete`}
				</p> :
				<>
					<form id="payment-form" onSubmit={handleSubmit}>
						<div>
							<label htmlFor="name">Name</label>
							<input name="name" id="name" onChange={changeName} required/>
						</div>
						<div className="mt-2">
							<label htmlFor="email">Email</label>
							<input name="email" type="email" id="email" onChange={changeEmail} required/>
						</div>
						<p className="mt-2">Enter your card details below:</p>
						<CardElement id="card-element" options={cardStyle} onChange={handleChange}/>
						<button
							disabled={processing || disabled || !email || !name}
							id="submit"
							className="mt-2"
						>
					        <span id="button-text">
					          {processing ? (
						          <div className="spinner" id="spinner"/>
					          ) : (
						          "Pay now"
					          )}
					        </span>
						</button>
						{/* Show any error that happens when processing the payment */}
						{error && (
							<div className="mt-2 p-2 bg-red-400 text-white text-center" role="alert">
								{error}
							</div>
						)}
					</form>
				</>}
			<p className="mt-2">
				<a href="#" onClick={reset} className="text-blue-500 hover:text-blue-700 font-bold">Set up a new payment</a>
			</p>
		</div>
	);
}
