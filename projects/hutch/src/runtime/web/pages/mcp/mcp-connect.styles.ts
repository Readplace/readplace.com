export const MCP_CONNECT_STYLES = `
.mcp-connect {
	padding: 80px 20px;
}

.mcp-connect__container {
	max-width: 720px;
	margin: 0 auto;
}

.mcp-connect__title {
	font-family: var(--font-serif);
	font-size: 2rem;
	font-weight: 700;
	margin-bottom: 8px;
	color: var(--foreground);
}

.mcp-connect__lead {
	font-size: 1.0625rem;
	line-height: 1.7;
	color: var(--muted-foreground);
	margin-bottom: 28px;
}

.mcp-connect__url {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px 10px;
	padding: 16px 20px;
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
	background: var(--muted);
	margin-bottom: 12px;
}

.mcp-connect__url-label {
	flex: 0 0 100%;
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--muted-foreground);
}

.mcp-connect__url-value {
	flex: 1 1 auto;
	min-width: 0;
	font-size: 1.0625rem;
	font-weight: 600;
	color: var(--foreground);
	word-break: break-all;
}

.mcp-connect__copy {
	flex: 0 0 auto;
}

.mcp-connect__copy[hidden] {
	display: none;
}

.mcp-connect__note {
	font-size: 0.9375rem;
	line-height: 1.6;
	color: var(--muted-foreground);
	margin-bottom: 40px;
}

.mcp-connect__tool {
	margin-bottom: 32px;
}

.mcp-connect__tool-name {
	font-family: var(--font-serif);
	font-size: 1.25rem;
	font-weight: 600;
	margin-bottom: 6px;
	color: var(--foreground);
}

.mcp-connect__tool-req {
	font-size: 1rem;
	line-height: 1.7;
	color: var(--muted-foreground);
	margin-bottom: 12px;
}

.mcp-connect__steps {
	padding-left: 22px;
	margin: 0;
}

.mcp-connect__step {
	font-size: 1rem;
	line-height: 1.7;
	color: var(--muted-foreground);
	margin-bottom: 6px;
}

.mcp-connect__tool-req strong {
	color: var(--foreground);
	font-weight: 600;
}

.mcp-connect__operations {
	list-style: none;
	padding: 0;
	margin: 0 0 12px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.mcp-connect__operation {
	font-size: 1rem;
	line-height: 1.7;
	color: var(--muted-foreground);
}

.mcp-connect__operation-name {
	font-weight: 600;
	color: var(--foreground);
}

.mcp-connect__examples {
	list-style: none;
	padding: 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.mcp-connect__example {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px 10px;
	font-size: 1rem;
	line-height: 1.6;
	color: var(--foreground);
	padding: 12px 16px;
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
	background: var(--muted);
}

.mcp-connect__example-label {
	flex: 0 0 100%;
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--muted-foreground);
}

.mcp-connect__example-text {
	flex: 1 1 auto;
	min-width: 0;
}

.mcp-connect__example-text::before {
	content: "“";
	color: var(--muted-foreground);
}

.mcp-connect__example-text::after {
	content: "”";
	color: var(--muted-foreground);
}
`;
