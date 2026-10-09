// How large one tool result may be on the wire before an MCP client drops the whole connection.
//
// Over stdio a JSON-RPC message is one newline-delimited line, and the MCP TypeScript SDK's
// `ReadBuffer` refuses to hold more than 10 MiB of an unfinished line. Past that it throws, and a
// newline-delimited stream has no boundary to resync on, so the client closes the transport: every
// later call fails with "Not connected" until the user reconnects by hand. Measured with Claude
// Code (which raises its own ceiling): an 11.2 MB scan arrived, a 22.5 MB one closed the connection.
// The limit is set by the strictest client, the SDK default, since a server cannot tell which
// client is reading.
//
// Nothing past the limit can be recovered by the client, so a result that would cross it has to be
// shaped on this side — trimmed with a note saying what was left out, or refused with one saying how
// to ask for less. Either is a reply the caller can act on; a dropped connection is not.
//
// The margins below are deliberately thin. Everything under the limit used to arrive whole, so every
// byte of margin is a result that stops arriving whole: they cover only what rides alongside the
// payload, which measures in the hundreds of bytes.

/** The client's ceiling: a single message larger than this loses the connection. */
export const CLIENT_MESSAGE_LIMIT_BYTES = 10 * 1024 * 1024;

/**
 * The most a tool result's content may occupy, once escaped into the JSON-RPC line. The rest of the
 * limit is the envelope around it (`{"jsonrpc":"2.0","id":…,"result":{"content":[…]}}`, ~100
 * bytes). A result past this is refused rather than sent; the plugin stops serializing once its
 * output is certain to pass it.
 */
export const TOOL_RESULT_LIMIT_BYTES = CLIENT_MESSAGE_LIMIT_BYTES - 16 * 1024;

/**
 * What a trimmed node list may fill: the result limit less room for the notices appended after it
 * (routing / plugin-skew, a few hundred bytes each). Only a list that does not fit whole is
 * trimmed.
 */
export const NODE_LIST_BUDGET_BYTES = TOOL_RESULT_LIMIT_BYTES - 4 * 1024;
