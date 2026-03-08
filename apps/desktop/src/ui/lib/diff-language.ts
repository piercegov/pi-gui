const EXTENSION_LANGUAGE_MAP = new Map<string, string>([
	[".astro", "markup"],
	[".bash", "bash"],
	[".c", "c"],
	[".cc", "cpp"],
	[".cpp", "cpp"],
	[".cs", "csharp"],
	[".css", "css"],
	[".go", "go"],
	[".h", "c"],
	[".hpp", "cpp"],
	[".htm", "markup"],
	[".html", "markup"],
	[".ini", "ini"],
	[".java", "java"],
	[".js", "javascript"],
	[".json", "json"],
	[".jsx", "jsx"],
	[".kt", "kotlin"],
	[".kts", "kotlin"],
	[".less", "less"],
	[".lua", "lua"],
	[".m", "objectivec"],
	[".make", "makefile"],
	[".md", "markdown"],
	[".php", "php"],
	[".pl", "perl"],
	[".py", "python"],
	[".r", "r"],
	[".rb", "ruby"],
	[".rs", "rust"],
	[".sass", "sass"],
	[".scss", "scss"],
	[".sh", "bash"],
	[".sql", "sql"],
	[".svg", "markup"],
	[".swift", "swift"],
	[".toml", "ini"],
	[".ts", "typescript"],
	[".tsx", "tsx"],
	[".vue", "markup"],
	[".xml", "markup"],
	[".yaml", "yaml"],
	[".yml", "yaml"],
]);

const BASENAME_LANGUAGE_MAP = new Map<string, string>([
	["dockerfile", "docker"],
	["gemfile", "ruby"],
	["makefile", "makefile"],
]);

function lastExtensionSegment(filePath: string) {
	const basename = filePath.split("/").at(-1) ?? filePath;
	const dotIndex = basename.lastIndexOf(".");
	if (dotIndex <= 0) return "";
	return basename.slice(dotIndex).toLowerCase();
}

export function detectDiffLanguage(filePath: string) {
	const basename = filePath.split("/").at(-1)?.toLowerCase() ?? filePath.toLowerCase();
	const specialCase = BASENAME_LANGUAGE_MAP.get(basename);
	if (specialCase) return specialCase;

	const extension = lastExtensionSegment(filePath);
	if (!extension) return undefined;
	return EXTENSION_LANGUAGE_MAP.get(extension);
}
