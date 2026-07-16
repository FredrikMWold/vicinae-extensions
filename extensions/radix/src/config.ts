export const AZURE_TENANT_ID = "3aa4a235-b6e2-48d5-9195-7fcf05b459b0";
export const RADIX_CLIENT_ID = "ed6cb804-8193-4e55-9d3d-8b88688482b3";
export const RADIX_API_SCOPE = "6dae42f8-4368-4678-94ff-3960e28e3630/.default";
export const RADIX_AUTH_SCOPE = `${RADIX_API_SCOPE} offline_access`;
export const RADIX_API_BASE_PATH = "/api/v1";

export const AUTHORIZATION_ENDPOINT = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/authorize`;
export const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;

export const RADIX_CONTEXTS = [
	"platform",
	"production",
	"platform2",
	"platform3",
	"playground",
	"development",
] as const;

export type RadixContext = (typeof RADIX_CONTEXTS)[number];

export type RadixPreferences = {
	context?: RadixContext;
	cluster?: string;
	applications?: string;
};

type ContextEndpointPattern = {
	zoneDomain: string;
	defaultApiEnvironment: string;
};

const CONTEXT_ENDPOINT_PATTERNS: Record<RadixContext, ContextEndpointPattern> =
	{
		development: { zoneDomain: "dev.", defaultApiEnvironment: "qa" },
		playground: { zoneDomain: "playground.", defaultApiEnvironment: "prod" },
		platform2: { zoneDomain: "c2.", defaultApiEnvironment: "prod" },
		platform3: { zoneDomain: "c3.", defaultApiEnvironment: "prod" },
		production: { zoneDomain: "", defaultApiEnvironment: "prod" },
		platform: { zoneDomain: "", defaultApiEnvironment: "prod" },
	};

export const getRadixContext = (context: string | undefined): RadixContext => {
	if (context && RADIX_CONTEXTS.includes(context as RadixContext)) {
		return context as RadixContext;
	}

	return "platform";
};

export const getRadixApiHost = (preferences: RadixPreferences = {}) => {
	const context = getRadixContext(preferences.context);
	const pattern = CONTEXT_ENDPOINT_PATTERNS[context];
	const apiEnvironment = pattern.defaultApiEnvironment;
	const cluster = preferences.cluster?.trim();

	if (cluster) {
		return `server-radix-api-${apiEnvironment}.${cluster}.${pattern.zoneDomain}radix.equinor.com`;
	}

	return `server-radix-api-${apiEnvironment}.${pattern.zoneDomain}radix.equinor.com`;
};

export const getRadixApiBaseUrl = (preferences: RadixPreferences = {}) => {
	return `https://${getRadixApiHost(preferences)}${RADIX_API_BASE_PATH}`;
};

export const getApplicationFilter = (preferences: RadixPreferences = {}) => {
	return (preferences.applications ?? "")
		.split(/[\n,]/)
		.map((application) => application.trim())
		.filter(Boolean);
};
