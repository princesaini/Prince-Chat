# Prince Chat

Prince Chat is a small, private-feeling chat interface for OpenRouter. Add your own OpenRouter API key, choose a model, and start chatting. It is built with Next.js, React, Tailwind CSS, and shadcn/ui.

It is designed for people who want a simple way to try different OpenRouter models without configuring environment variables or building their own API client first.

## What you can do

- Chat with OpenRouter text models and see responses stream in as they are generated.
- Attach images or PDF documents when using multimodal vision or file-capable models.
- Pick a model from a searchable list in the top navbar.
- See each model's input and output price per one million tokens, plus its context-window size.
- See the input and output tokens plus estimated cost beneath each text response.
- Regenerate responses with the same model or retry with another compatible model.
- Edit and resend any user message with automatic conversation branch updating.
- Set custom system instructions or persona from the response controls.
- Generate images when you choose a model that supports image output.
- Turn OpenRouter web search on or off from the response-controls menu.
- Set a reasoning effort level when the selected model supports it.
- Stop a response while it is generating.
- Copy message contents or code blocks with one click.
- Export your full conversation to a Markdown (`.md`) file.
- Jump quickly to recent messages with the floating scroll-to-bottom button.
- Retry failed requests directly with the inline retry banner.
- Start a fresh chat at any time.
- Use the app in light or dark mode on desktop or mobile.

## Quick start

You need Node.js and an OpenRouter API key.

1. Install the project dependencies.

   ```bash
   npm install
   ```

2. Start the development server.

   ```bash
   npm run dev
   ```

3. Open [http://localhost:9002](http://localhost:9002).

4. Select the key icon in the top-right corner, paste your OpenRouter API key, and save it.

5. Select the model button in the navbar, choose a model, then send your first message.

There is no `.env` file to create for normal local use. Your key is entered in the app itself.

## Using the app

### Choose a model

Select the model button in the navbar. The list is searchable and starts with popular models. Each row shows:

- The model ID and name
- Input and output pricing per 1M tokens
- Context-window size
- An `Image` label when the model can generate images

Search also matches capability labels such as `Vision`, `Image`, and `File`, so entering `vision` shows every model that accepts image input.

Use the refresh button in the picker after changing your API key or when you want the latest model list.

### Adjust response controls

Select the sliders icon in the navbar to open **Response controls**.

- **Web search** lets a compatible model use OpenRouter's web-search tool for current information.
- **Reasoning effort** controls how much extra thinking a compatible reasoning model uses. Higher settings may improve difficult answers, but can take longer and cost more. The menu only enables choices that the selected model reports as supported.
- **System instructions** lets you specify custom instructions or personas that guide how the model responds across all messages.

These controls apply to the next message you send and are remembered in the current browser.

### Export conversation

Select the download icon in the navbar to download your full conversation as a formatted Markdown (`.md`) file, including prompt attachments, timestamps, and token usage metrics.

### Generate an image

Choose a model marked `Image`, then enter a description of the image you want. Prince Chat sends the prompt to OpenRouter's image endpoint and displays the generated images in the conversation.

### Start over

Select the plus icon in the navbar to clear the current conversation. Prince Chat does not keep a chat-history library: messages exist only while the page is open and are cleared when you refresh or close it.

## Privacy and API keys

Your OpenRouter API key, selected model, web-search preference, reasoning preference, and system instructions are saved in your browser's local storage. The key is sent with requests through the app's local Next.js API route, which forwards the request to OpenRouter.

This is convenient for personal local use, but local storage is not a secure vault. Do not use this setup in a shared browser profile or on a device you do not trust. For a public or multi-user deployment, move key management to a secure server-side authentication flow.

Your prompts and generated responses are sent to OpenRouter and the selected model provider as part of each request. Review OpenRouter's policies and the model provider's policies before sending sensitive information.

## Costs

Prince Chat shows the input and output prices returned by OpenRouter in the model picker. These prices are useful for comparing models, but the final amount charged depends on the tokens and features used in a request. Web search, image generation, and reasoning can add cost.

You are responsible for charges on the OpenRouter account connected to your API key.

## Development commands

```bash
# Start the local development server on port 9002
npm run dev

# Check TypeScript types
npm run typecheck

# Create an optimized production build
npm run build

# Run the production server after building
npm run start
```

## How it works

The browser talks to a small Next.js route under `/api/openrouter`. That route forwards the request to OpenRouter, including your API key in the authorization header. This keeps the browser code simple while preserving streaming responses from the OpenRouter chat endpoint.

The main interface lives in `src/app/page.tsx`, and the OpenRouter forwarding route lives in `src/app/api/openrouter/[[...route]]/route.ts`.

## Troubleshooting

**The model list is empty**

Check that you saved a valid OpenRouter API key, then reopen the model picker and select Refresh.

**I cannot send a message**

Make sure both an API key and a model are selected. The composer stays disabled until both are available.

**A model does not show reasoning controls**

Not every model supports configurable reasoning effort. Choose a reasoning-capable model to enable that control.

**A request fails**

Confirm that your API key is valid, your OpenRouter account has available credits, and the selected model is available to your account.

**The app will not start**

Run `npm install` again, then try `npm run dev`. If the port is already in use, stop the other process using port 9002 or change the port in the `dev` script in `package.json`.
