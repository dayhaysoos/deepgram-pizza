# Nick's Pizza

Talk to a pizza shop. A voice agent answers questions about the menu, suggests what goes well together, plans orders for groups, and edits your cart as you talk, then sends you to Stripe Checkout.

Clone it to put voice ordering on your own shop: swap the menu, the photos and the agent's instructions.

> Work in progress. Setup steps and a screenshot land as the app is built.

## Stack

- [TanStack Start](https://tanstack.com/start/latest) (React) on [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Deepgram Voice Agent](https://developers.deepgram.com/docs/voice-agent) for listening, thinking and speaking
- [use-shopping-cart](https://useshoppingcart.com) for the cart
- [Stripe Checkout](https://docs.stripe.com/checkout/quickstart) in test mode

## How it works

The cart lives in the browser. When you ask for something, the voice agent calls a tool, and the tool updates the cart on the page. The server does two things: it mints a short-lived Deepgram token, so your API key never reaches the browser, and it creates the Stripe Checkout session from prices it checks itself.

## License

Code: [MIT](LICENSE). Food photos keep their own licenses; see [CREDITS.md](CREDITS.md).
