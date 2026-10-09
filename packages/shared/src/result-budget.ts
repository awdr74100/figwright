// How large one tool result may be on the wire before an MCP client drops the whole connection.
//
// Over stdio a JSON-RPC message is one newline-delimited line, and the MCP TypeScript SDK's
// `ReadBuffer` refuses to hold more than 10 MiB of an unfinished line. Past that it throws, and a
// newline-delimited stream has no boundary to resync on, so the client closes the transport: every
// later call fails with "Not connected" until the user reconnects by hand. Measured with Claude
// Code (which raises its own ceiling): an 11.2 MB scan arrived, a 22.5 MB one closed the connection.
// The budget is set by the strictest client, the SDK default, since a server cannot tell which
// client is reading.
//
// Nothing past the limit can be recovered by the client, so a result that would cross it has to be
// shaped on this side — trimmed with a note saying what was left out, or refused with one saying how
// to ask for less. Either is a reply the caller can act on; a dropped connection is not.

/** The hard ceiling: a single message larger than this loses the client connection. */
export const CLIENT_MESSAGE_LIMIT_BYTES = 10 * 1024 * 1024;

/**
 * What a tool result aims to fit in, leaving room under the hard ceiling for the JSON-RPC envelope
 * and any notices appended after the payload.
 */
export const TOOL_RESULT_BUDGET_BYTES = CLIENT_MESSAGE_LIMIT_BYTES - 512 * 1024;
