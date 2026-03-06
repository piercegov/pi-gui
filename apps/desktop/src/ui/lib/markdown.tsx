import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "./shiki";

function CodeBlock(props: {
	inline?: boolean;
	className?: string;
	children?: ReactNode;
}) {
	const language = props.className?.replace("language-", "") ?? "text";
	const code = String(props.children ?? "");
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (!props.inline) {
			void highlightCode(code, language).then((result) => {
				if (!cancelled) setHtml(result);
			});
		}
		return () => {
			cancelled = true;
		};
	}, [code, language, props.inline]);

	if (props.inline) {
		return <code>{code}</code>;
	}

	if (!html) {
		return (
			<pre className="overflow-auto mono">
				<code>{code}</code>
			</pre>
		);
	}

	return (
		<div
			className="overflow-auto [&_pre]:!bg-transparent [&_pre]:p-3"
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

export function MarkdownRenderer(props: { markdown: string; className?: string }) {
	return (
		<div className={`markdown ${props.className ?? ""}`.trim()}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					code({ className, children }) {
						const inline =
							!className && !String(children ?? "").includes("\n");
						return (
							<CodeBlock inline={inline} className={className}>
								{children}
							</CodeBlock>
						);
					},
					a({ href, children }) {
						const safeHref = href?.startsWith("http") ? href : undefined;
						return (
							<a
								href={safeHref}
								className="text-accent underline underline-offset-2"
							>
								{children}
							</a>
						);
					},
				}}
			>
				{props.markdown}
			</ReactMarkdown>
		</div>
	);
}
