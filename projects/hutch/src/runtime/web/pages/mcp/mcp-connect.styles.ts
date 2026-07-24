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
	flex-direction: column;
	gap: 6px;
	padding: 16px 20px;
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
	background: var(--muted);
	margin-bottom: 12px;
}

.mcp-connect__url-label {
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--muted-foreground);
}

.mcp-connect__url-value {
	font-size: 1.0625rem;
	font-weight: 600;
	color: var(--foreground);
	word-break: break-all;
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

.mcp-connect__examples {
	list-style: none;
	padding: 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.mcp-connect__example {
	font-size: 1rem;
	line-height: 1.6;
	color: var(--foreground);
	padding: 12px 16px;
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
	background: var(--muted);
}

.mcp-connect__example::before {
	content: "“";
	color: var(--muted-foreground);
}

.mcp-connect__example::after {
	content: "”";
	color: var(--muted-foreground);
}
`;
