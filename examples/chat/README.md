# Demo chat

A tiny two-person chat to try cast in two minutes. No dependencies.

```bash
node examples/chat/server.mjs      # http://localhost:3000
```

Users: `sam` and `elon`, password `demo`. Sessions last 30 days.

Then in Claude Code:

```
/cast:add Sam      → open http://localhost:3000, sign in as sam, close the window
/cast:add Elon     → the same as elon
```

And ask Claude:

> Send "Hi Elon!" from Sam and check that Elon gets it.

Messages are kept in memory, so restarting the server clears the chat. Sign-ins survive restarts.
