package agent

import (
	"log/slog"
	"strings"
	"testing"
)

func TestNewReturnsOpenclawBackend(t *testing.T) {
	t.Parallel()
	b, err := New("openclaw", Config{ExecutablePath: "/nonexistent/openclaw"})
	if err != nil {
		t.Fatalf("New(openclaw) error: %v", err)
	}
	if _, ok := b.(*openclawBackend); !ok {
		t.Fatalf("expected *openclawBackend, got %T", b)
	}
}

// ── Text event tests ──

func TestOpenclawHandleTextEvent(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{}
	ch := make(chan Message, 10)
	var output strings.Builder

	event := openclawEvent{
		Type:      "text",
		SessionID: "ses_abc",
		Data:      map[string]any{"text": "Hello from openclaw"},
	}

	b.handleOCTextEvent(event, ch, &output)

	if output.String() != "Hello from openclaw" {
		t.Errorf("output: got %q, want %q", output.String(), "Hello from openclaw")
	}
	msg := <-ch
	if msg.Type != MessageText {
		t.Errorf("type: got %v, want MessageText", msg.Type)
	}
	if msg.Content != "Hello from openclaw" {
		t.Errorf("content: got %q, want %q", msg.Content, "Hello from openclaw")
	}
}

func TestOpenclawHandleTextEventEmpty(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{}
	ch := make(chan Message, 10)
	var output strings.Builder

	event := openclawEvent{
		Type: "text",
		Data: map[string]any{"text": ""},
	}

	b.handleOCTextEvent(event, ch, &output)

	if output.String() != "" {
		t.Errorf("expected empty output, got %q", output.String())
	}
	if len(ch) != 0 {
		t.Errorf("expected no messages, got %d", len(ch))
	}
}

func TestOpenclawHandleTextEventNilData(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{}
	ch := make(chan Message, 10)
	var output strings.Builder

	event := openclawEvent{Type: "text"}

	b.handleOCTextEvent(event, ch, &output)

	if output.String() != "" {
		t.Errorf("expected empty output, got %q", output.String())
	}
	if len(ch) != 0 {
		t.Errorf("expected no messages, got %d", len(ch))
	}
}

// ── Thinking event tests ──

func TestOpenclawHandleThinkingEvent(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{}
	ch := make(chan Message, 10)

	event := openclawEvent{
		Type: "thinking",
		Data: map[string]any{"text": "Let me think about this..."},
	}

	b.handleOCThinkingEvent(event, ch)

	if len(ch) != 1 {
		t.Fatalf("expected 1 message, got %d", len(ch))
	}
	msg := <-ch
	if msg.Type != MessageThinking {
		t.Errorf("type: got %v, want MessageThinking", msg.Type)
	}
	if msg.Content != "Let me think about this..." {
		t.Errorf("content: got %q", msg.Content)
	}
}

// ── Tool call event tests ──

func TestOpenclawHandleToolCallCompleted(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{}
	ch := make(chan Message, 10)

	event := openclawEvent{
		Type: "tool_call",
		Data: map[string]any{
			"name":   "bash",
			"callId": "call_123",
			"input":  map[string]any{"command": "pwd"},
			"status": "completed",
			"output": "/tmp/project\n",
		},
	}

	b.handleOCToolCallEvent(event, ch)

	// Should emit both tool-use and tool-result.
	if len(ch) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(ch))
	}

	// First: tool-use
	msg := <-ch
	if msg.Type != MessageToolUse {
		t.Errorf("type: got %v, want MessageToolUse", msg.Type)
	}
	if msg.Tool != "bash" {
		t.Errorf("tool: got %q, want %q", msg.Tool, "bash")
	}
	if msg.CallID != "call_123" {
		t.Errorf("callID: got %q, want %q", msg.CallID, "call_123")
	}
	if cmd, ok := msg.Input["command"].(string); !ok || cmd != "pwd" {
		t.Errorf("input.command: got %v", msg.Input["command"])
	}

	// Second: tool-result
	msg = <-ch
	if msg.Type != MessageToolResult {
		t.Errorf("type: got %v, want MessageToolResult", msg.Type)
	}
	if msg.Output != "/tmp/project\n" {
		t.Errorf("output: got %q", msg.Output)
	}
}

func TestOpenclawHandleToolCallPending(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{}
	ch := make(chan Message, 10)

	event := openclawEvent{
		Type: "tool_call",
		Data: map[string]any{
			"name":   "read",
			"callId": "call_456",
			"input":  map[string]any{"filePath": "/tmp/test.go"},
			"status": "pending",
		},
	}

	b.handleOCToolCallEvent(event, ch)

	if len(ch) != 1 {
		t.Fatalf("expected 1 message for pending tool, got %d", len(ch))
	}
	msg := <-ch
	if msg.Type != MessageToolUse {
		t.Errorf("type: got %v, want MessageToolUse", msg.Type)
	}
}

func TestOpenclawHandleToolCallNilData(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{}
	ch := make(chan Message, 10)

	event := openclawEvent{Type: "tool_call"}

	b.handleOCToolCallEvent(event, ch)

	if len(ch) != 0 {
		t.Errorf("expected no messages for nil data, got %d", len(ch))
	}
}

// ── Error event tests ──

func TestOpenclawHandleErrorEvent(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{cfg: Config{Logger: slog.Default()}}
	ch := make(chan Message, 10)
	status := "completed"
	errMsg := ""

	event := openclawEvent{
		Type:      "error",
		SessionID: "ses_abc",
		Data:      map[string]any{"message": "Model not found: bad/model"},
	}

	b.handleOCErrorEvent(event, ch, &status, &errMsg)

	if status != "failed" {
		t.Errorf("status: got %q, want %q", status, "failed")
	}
	if errMsg != "Model not found: bad/model" {
		t.Errorf("error: got %q", errMsg)
	}
	msg := <-ch
	if msg.Type != MessageError {
		t.Errorf("type: got %v, want MessageError", msg.Type)
	}
}

func TestOpenclawHandleErrorEventCodeOnly(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{cfg: Config{Logger: slog.Default()}}
	ch := make(chan Message, 10)
	status := "completed"
	errMsg := ""

	event := openclawEvent{
		Type: "error",
		Data: map[string]any{"code": "RateLimitError"},
	}

	b.handleOCErrorEvent(event, ch, &status, &errMsg)

	if errMsg != "RateLimitError" {
		t.Errorf("error: got %q, want %q", errMsg, "RateLimitError")
	}
}

func TestOpenclawHandleErrorEventNilData(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{cfg: Config{Logger: slog.Default()}}
	ch := make(chan Message, 10)
	status := "completed"
	errMsg := ""

	event := openclawEvent{Type: "error"}

	b.handleOCErrorEvent(event, ch, &status, &errMsg)

	if errMsg != "unknown openclaw error" {
		t.Errorf("error: got %q, want %q", errMsg, "unknown openclaw error")
	}
}

// ── Integration-level tests: processEvents ──

func TestOpenclawProcessEventsHappyPath(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{cfg: Config{Logger: slog.Default()}}
	ch := make(chan Message, 256)

	// Simulate a successful run: step_start → text → tool_call → text → step_end
	lines := strings.Join([]string{
		`{"type":"step_start","sessionId":"ses_happy"}`,
		`{"type":"text","sessionId":"ses_happy","data":{"text":"Analyzing..."}}`,
		`{"type":"tool_call","sessionId":"ses_happy","data":{"name":"bash","callId":"call_1","input":{"command":"ls"},"status":"completed","output":"file.go\n"}}`,
		`{"type":"text","sessionId":"ses_happy","data":{"text":" Done."}}`,
		`{"type":"step_end","sessionId":"ses_happy"}`,
	}, "\n")

	result := b.processEvents(strings.NewReader(lines), ch)

	if result.status != "completed" {
		t.Errorf("status: got %q, want %q", result.status, "completed")
	}
	if result.sessionID != "ses_happy" {
		t.Errorf("sessionID: got %q, want %q", result.sessionID, "ses_happy")
	}
	if result.output != "Analyzing... Done." {
		t.Errorf("output: got %q, want %q", result.output, "Analyzing... Done.")
	}
	if result.errMsg != "" {
		t.Errorf("errMsg: got %q, want empty", result.errMsg)
	}

	// Drain and verify messages.
	close(ch)
	var msgs []Message
	for m := range ch {
		msgs = append(msgs, m)
	}

	// Expected: status(running), text, tool-use, tool-result, text = 5 messages
	if len(msgs) != 5 {
		t.Fatalf("expected 5 messages, got %d: %+v", len(msgs), msgs)
	}
	if msgs[0].Type != MessageStatus || msgs[0].Status != "running" {
		t.Errorf("msg[0]: got %+v, want status=running", msgs[0])
	}
	if msgs[1].Type != MessageText || msgs[1].Content != "Analyzing..." {
		t.Errorf("msg[1]: got %+v", msgs[1])
	}
	if msgs[2].Type != MessageToolUse || msgs[2].Tool != "bash" {
		t.Errorf("msg[2]: got %+v, want tool-use(bash)", msgs[2])
	}
	if msgs[3].Type != MessageToolResult || msgs[3].Output != "file.go\n" {
		t.Errorf("msg[3]: got %+v, want tool-result", msgs[3])
	}
	if msgs[4].Type != MessageText || msgs[4].Content != " Done." {
		t.Errorf("msg[4]: got %+v", msgs[4])
	}
}

func TestOpenclawProcessEventsErrorCausesFailedStatus(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{cfg: Config{Logger: slog.Default()}}
	ch := make(chan Message, 256)

	lines := strings.Join([]string{
		`{"type":"step_start","sessionId":"ses_err"}`,
		`{"type":"error","sessionId":"ses_err","data":{"message":"Model not found: bad/model"}}`,
		`{"type":"step_end","sessionId":"ses_err"}`,
	}, "\n")

	result := b.processEvents(strings.NewReader(lines), ch)

	if result.status != "failed" {
		t.Errorf("status: got %q, want %q", result.status, "failed")
	}
	if result.errMsg != "Model not found: bad/model" {
		t.Errorf("errMsg: got %q", result.errMsg)
	}
	if result.sessionID != "ses_err" {
		t.Errorf("sessionID: got %q, want %q", result.sessionID, "ses_err")
	}

	close(ch)
	var errorMsgs int
	for m := range ch {
		if m.Type == MessageError {
			errorMsgs++
		}
	}
	if errorMsgs != 1 {
		t.Errorf("expected 1 error message, got %d", errorMsgs)
	}
}

func TestOpenclawProcessEventsSessionIDExtracted(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{cfg: Config{Logger: slog.Default()}}
	ch := make(chan Message, 256)

	lines := strings.Join([]string{
		`{"type":"step_start","sessionId":"ses_first"}`,
		`{"type":"text","sessionId":"ses_updated","data":{"text":"hi"}}`,
	}, "\n")

	result := b.processEvents(strings.NewReader(lines), ch)

	if result.sessionID != "ses_updated" {
		t.Errorf("sessionID: got %q, want %q (should use last seen)", result.sessionID, "ses_updated")
	}

	close(ch)
}

func TestOpenclawProcessEventsScannerError(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{cfg: Config{Logger: slog.Default()}}
	ch := make(chan Message, 256)

	result := b.processEvents(&ioErrReader{
		data: `{"type":"text","sessionId":"ses_scan","data":{"text":"before error"}}` + "\n",
	}, ch)

	if result.status != "failed" {
		t.Errorf("status: got %q, want %q", result.status, "failed")
	}
	if !strings.Contains(result.errMsg, "stdout read error") {
		t.Errorf("errMsg: got %q, want it to contain 'stdout read error'", result.errMsg)
	}
	if result.output != "before error" {
		t.Errorf("output: got %q, want %q", result.output, "before error")
	}

	close(ch)
}

func TestOpenclawProcessEventsEmptyLines(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{cfg: Config{Logger: slog.Default()}}
	ch := make(chan Message, 256)

	lines := strings.Join([]string{
		"",
		"   ",
		"not json at all",
		`{"type":"text","sessionId":"ses_ok","data":{"text":"valid"}}`,
		"",
	}, "\n")

	result := b.processEvents(strings.NewReader(lines), ch)

	if result.status != "completed" {
		t.Errorf("status: got %q, want %q", result.status, "completed")
	}
	if result.output != "valid" {
		t.Errorf("output: got %q, want %q", result.output, "valid")
	}
	if result.sessionID != "ses_ok" {
		t.Errorf("sessionID: got %q, want %q", result.sessionID, "ses_ok")
	}

	close(ch)
	var msgs []Message
	for m := range ch {
		msgs = append(msgs, m)
	}
	if len(msgs) != 1 || msgs[0].Type != MessageText {
		t.Errorf("expected 1 text message, got %d: %+v", len(msgs), msgs)
	}
}

func TestOpenclawProcessEventsErrorDoesNotRevertToCompleted(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{cfg: Config{Logger: slog.Default()}}
	ch := make(chan Message, 256)

	lines := strings.Join([]string{
		`{"type":"error","sessionId":"ses_x","data":{"message":"RateLimitError"}}`,
		`{"type":"text","sessionId":"ses_x","data":{"text":"recovered?"}}`,
	}, "\n")

	result := b.processEvents(strings.NewReader(lines), ch)

	if result.status != "failed" {
		t.Errorf("status: got %q, want %q (error should stick)", result.status, "failed")
	}
	if result.errMsg != "RateLimitError" {
		t.Errorf("errMsg: got %q, want %q", result.errMsg, "RateLimitError")
	}

	close(ch)
}

func TestOpenclawProcessEventsResultEvent(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{cfg: Config{Logger: slog.Default()}}
	ch := make(chan Message, 256)

	lines := strings.Join([]string{
		`{"type":"text","sessionId":"ses_r","data":{"text":"Done"}}`,
		`{"type":"result","sessionId":"ses_r","data":{"status":"completed"}}`,
	}, "\n")

	result := b.processEvents(strings.NewReader(lines), ch)

	if result.status != "completed" {
		t.Errorf("status: got %q, want %q", result.status, "completed")
	}
	if result.output != "Done" {
		t.Errorf("output: got %q, want %q", result.output, "Done")
	}

	close(ch)
}

func TestOpenclawProcessEventsResultErrorStatus(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{cfg: Config{Logger: slog.Default()}}
	ch := make(chan Message, 256)

	lines := strings.Join([]string{
		`{"type":"result","sessionId":"ses_rf","data":{"status":"error","error":"out of tokens"}}`,
	}, "\n")

	result := b.processEvents(strings.NewReader(lines), ch)

	if result.status != "failed" {
		t.Errorf("status: got %q, want %q", result.status, "failed")
	}
	if result.errMsg != "out of tokens" {
		t.Errorf("errMsg: got %q, want %q", result.errMsg, "out of tokens")
	}

	close(ch)
}

// ── openclawExtractText tests ──

func TestExtractEventTextDirect(t *testing.T) {
	t.Parallel()
	data := map[string]any{"text": "hello"}
	if got := openclawExtractText(data); got != "hello" {
		t.Errorf("got %q, want %q", got, "hello")
	}
}

func TestExtractEventTextNested(t *testing.T) {
	t.Parallel()
	data := map[string]any{
		"content": map[string]any{"text": "nested hello"},
	}
	if got := openclawExtractText(data); got != "nested hello" {
		t.Errorf("got %q, want %q", got, "nested hello")
	}
}

func TestExtractEventTextNil(t *testing.T) {
	t.Parallel()
	if got := openclawExtractText(nil); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

// ── Thinking event with nested content ──

func TestOpenclawHandleThinkingEventNestedContent(t *testing.T) {
	t.Parallel()

	b := &openclawBackend{}
	ch := make(chan Message, 10)

	event := openclawEvent{
		Type: "thinking",
		Data: map[string]any{
			"content": map[string]any{"text": "Nested thinking"},
		},
	}

	b.handleOCThinkingEvent(event, ch)

	if len(ch) != 1 {
		t.Fatalf("expected 1 message, got %d", len(ch))
	}
	msg := <-ch
	if msg.Type != MessageThinking {
		t.Errorf("type: got %v, want MessageThinking", msg.Type)
	}
	if msg.Content != "Nested thinking" {
		t.Errorf("content: got %q, want %q", msg.Content, "Nested thinking")
	}
}
