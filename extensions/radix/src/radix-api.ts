import { getPreferenceValues } from "@vicinae/api";
import { AuthenticationRequiredError, getValidAccessToken } from "./auth";
import {
	getApplicationFilter,
	getRadixApiBaseUrl,
	getRadixApiHost,
	type RadixPreferences,
} from "./config";

export type ClusterConfiguration = Record<string, unknown>;

export type RadixApplicationSummary = {
	cost?: RadixApplicationCost;
	dnsAliases?: RadixDnsAlias[];
	dnsExternalAliases?: RadixDnsAlias[];
	name?: string;
	environments?: RadixEnvironmentSummary[];
	externalDNS?: RadixExternalDns[];
	jobs?: RadixJobSummary[];
	latestJob?: RadixJobSummary;
};

export type RadixApplicationCost = {
	comment?: string;
	costPercentageByCpu?: number;
	costPercentageByMemory?: number;
	creator?: string;
	owner?: string;
	raw?: unknown;
	value?: number | string;
	currency?: string;
	wbs?: string;
};

export type RadixExternalDns = {
	alias?: string;
	componentName?: string;
	environmentName?: string;
	fqdn?: string;
	host?: string;
	hostname?: string;
	url?: string;
};

export type RadixDnsAlias = {
	alias?: string;
	componentName?: string;
	environmentName?: string;
	fqdn?: string;
	host?: string;
	hostname?: string;
	url?: string;
};

export type RadixPort = {
	isPublic?: boolean;
	name?: string;
	port?: number;
};

export type RadixComponentSummary = {
	commitID?: string;
	dnsAliases?: RadixDnsAlias[];
	externalDNS?: RadixExternalDns[];
	gitTags?: string;
	image?: string;
	name?: string;
	ports?: RadixPort[];
	skipDeployment?: boolean;
	status?: string;
	type?: string;
};

export type RadixDeploymentSummary = {
	activeFrom?: string;
	activeTo?: string;
	builtFromBranch?: string;
	commitID?: string;
	components?: RadixComponentSummary[];
	createdByJob?: string;
	dnsAliases?: RadixDnsAlias[];
	environment?: string;
	externalDNS?: RadixExternalDns[];
	gitCommitHash?: string;
	gitRef?: string;
	gitRefType?: string;
	gitTags?: string;
	name?: string;
	pipelineJobType?: string;
	promotedFromEnvironment?: string;
	status?: string;
	statusReason?: string;
};

export type RadixEnvironmentSummary = {
	activeDeployment?: RadixDeploymentSummary;
	branchMapping?: string;
	dnsAliases?: RadixDnsAlias[];
	externalDNS?: RadixExternalDns[];
	name?: string;
	status?: string;
};

export type RadixJobSummary = {
	appName?: string;
	branch?: string;
	commitID?: string;
	created?: string;
	ended?: string;
	environments?: string[];
	gitRef?: string;
	gitRefType?: string;
	name?: string;
	pipeline?: string;
	promotedFromDeployment?: string;
	promotedFromEnvironment?: string;
	promotedToEnvironment?: string;
	started?: string;
	status?: string;
	triggeredBy?: string;
	triggeredFromWebhook?: boolean;
};

export type PipelineJobListItem = RadixJobSummary & {
	application?: RadixApplicationSummary;
	applicationName: string;
};

export type PipelineJobsResult = {
	applications: RadixApplicationSummary[];
	jobs: PipelineJobListItem[];
	failedApplications: Array<{ applicationName: string; message: string }>;
};

export type EnvironmentListItem = RadixEnvironmentSummary & {
	application?: RadixApplicationSummary;
	applicationName: string;
};

export type EnvironmentOverviewResult = {
	applications: RadixApplicationSummary[];
	environments: EnvironmentListItem[];
	failedApplications: Array<{ applicationName: string; message: string }>;
};

export class RadixApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly responseBody: string,
	) {
		super(message);
		this.name = "RadixApiError";
	}
}

export const getCurrentApiHost = () => {
	return getRadixApiHost(getPreferenceValues<RadixPreferences>());
};

export const getClusterConfiguration = async () => {
	return radixFetch<ClusterConfiguration>("/configuration");
};

export const getApplications = async () => {
	return radixFetch<RadixApplicationSummary[]>("/applications");
};

export const getApplication = async (applicationName: string) => {
	return radixFetch<RadixApplicationSummary>(
		`/applications/${encodeURIComponent(applicationName)}`,
	);
};

export const getApplicationOverview = async () => {
	const applications = await getApplications();

	return mapWithConcurrency(applications, 6, async (application) => {
		if (!application.name) {
			return application;
		}

		const [applicationDetails, jobs, cost] = await Promise.all([
			getApplicationDetailsOrFallback(application),
			getApplicationJobsOrEmpty(application.name),
			getApplicationCostOrUndefined(application.name),
		]);
		const latestJob = getLatestApplicationJob(
			jobs.length > 0 ? jobs : (applicationDetails.jobs ?? []),
		);

		return {
			...applicationDetails,
			cost: cost ?? applicationDetails.cost,
			latestJob: latestJob ?? applicationDetails.latestJob,
		};
	});
};

const getApplicationDetailsOrFallback = async (
	application: RadixApplicationSummary,
) => {
	if (!application.name) {
		return application;
	}

	try {
		return {
			...application,
			...(await getApplication(application.name)),
		};
	} catch {
		return application;
	}
};

const getApplicationJobsOrEmpty = async (applicationName: string) => {
	try {
		return await getApplicationJobs(applicationName);
	} catch {
		return [];
	}
};

const getApplicationCostOrUndefined = async (applicationName: string) => {
	try {
		return await getApplicationFutureCost(applicationName);
	} catch {
		return undefined;
	}
};

const getLatestApplicationJob = (jobs: RadixJobSummary[]) => {
	return [...jobs].sort(
		(left, right) => getJobSortTime(right) - getJobSortTime(left),
	)[0];
};

export const getApplicationFutureCost = async (
	applicationName: string,
): Promise<RadixApplicationCost> => {
	const accessToken = await getValidAccessToken();
	const response = await fetch(
		`https://console.radix.equinor.com/cost-api/futurecost/${encodeURIComponent(applicationName)}`,
		{
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
		},
	);

	if (!response.ok) {
		throw new RadixApiError(
			`Radix cost request failed with ${response.status} ${response.statusText}`,
			response.status,
			await response.text(),
		);
	}

	const raw = (await response.json()) as unknown;
	return {
		raw,
		value: extractCostValue(raw),
		currency: extractCostCurrency(raw),
		...extractCostMetadata(raw),
	};
};

export const getEnvironmentOverview = async (
	selectedApplicationName?: string,
): Promise<EnvironmentOverviewResult> => {
	const preferences = getPreferenceValues<RadixPreferences>();
	const configuredApplicationNames = getApplicationFilter(preferences);
	const applicationNames = selectedApplicationName
		? [selectedApplicationName]
		: configuredApplicationNames;
	const applications = applicationNames.map((name) => ({ name }));
	const results = await mapWithConcurrency(
		applicationNames,
		6,
		async (applicationName) => {
			try {
				const applicationDetails = await getApplicationDetailsOrFallback({
					name: applicationName,
				});
				const environmentSummaries = applicationDetails.environments?.length
					? applicationDetails.environments
					: await getApplicationEnvironments(applicationName);
				const environments = await mapWithConcurrency(
					environmentSummaries,
					6,
					async (environment) => {
						if (!environment.name) {
							return environment;
						}

						try {
							return {
								...environment,
								...(await getApplicationEnvironment(
									applicationName,
									environment.name,
								)),
							};
						} catch {
							return environment;
						}
					},
				);

				return {
					applicationName,
					environments: environments.map((environment) => ({
						...environment,
						application: applicationDetails,
						applicationName,
					})),
					error: undefined,
				};
			} catch (error) {
				if (error instanceof AuthenticationRequiredError) {
					throw error;
				}

				return {
					applicationName,
					environments: [],
					error: getErrorMessage(error),
				};
			}
		},
	);

	return {
		applications,
		environments: results
			.flatMap((result) => result.environments)
			.sort((left, right) => {
				const appCompare = left.applicationName.localeCompare(
					right.applicationName,
				);
				if (appCompare !== 0) {
					return appCompare;
				}

				return (left.name ?? "").localeCompare(right.name ?? "");
			}),
		failedApplications: results
			.filter((result) => result.error)
			.map((result) => ({
				applicationName: result.applicationName,
				message: result.error ?? "Unknown error",
			})),
	};
};

export const getApplicationEnvironments = async (applicationName: string) => {
	return radixFetch<RadixEnvironmentSummary[]>(
		`/applications/${encodeURIComponent(applicationName)}/environments`,
	);
};

export const getApplicationEnvironment = async (
	applicationName: string,
	environmentName: string,
) => {
	return radixFetch<RadixEnvironmentSummary>(
		`/applications/${encodeURIComponent(applicationName)}/environments/${encodeURIComponent(environmentName)}`,
	);
};

export const getApplicationJobs = async (applicationName: string) => {
	return radixFetch<RadixJobSummary[]>(
		`/applications/${encodeURIComponent(applicationName)}/jobs`,
	);
};

export const getPipelineJobsForAllApplications = async (
	selectedApplicationName?: string,
): Promise<PipelineJobsResult> => {
	const preferences = getPreferenceValues<RadixPreferences>();
	const configuredApplicationNames = getApplicationFilter(preferences);
	const applicationNames = selectedApplicationName
		? [selectedApplicationName]
		: configuredApplicationNames;
	const applications = applicationNames.map((name) => ({ name }));

	const results = await mapWithConcurrency(
		applicationNames,
		6,
		async (applicationName) => {
			try {
				const applicationDetails = await getApplicationDetailsOrFallback({
					name: applicationName,
				});
				const jobs = applicationDetails.jobs?.length
					? applicationDetails.jobs
					: await getApplicationJobs(applicationName);
				return {
					applicationName,
					jobs: jobs.map((job) => ({
						...job,
						application: applicationDetails,
						applicationName,
						appName: job.appName || applicationName,
					})),
					error: undefined,
				};
			} catch (error) {
				if (error instanceof AuthenticationRequiredError) {
					throw error;
				}

				return {
					applicationName,
					jobs: [],
					error: getErrorMessage(error),
				};
			}
		},
	);

	return {
		applications,
		jobs: results
			.flatMap((result) => result.jobs)
			.sort((left, right) => getJobSortTime(right) - getJobSortTime(left)),
		failedApplications: results
			.filter((result) => result.error)
			.map((result) => ({
				applicationName: result.applicationName,
				message: result.error ?? "Unknown error",
			})),
	};
};

export const radixFetch = async <T>(path: string): Promise<T> => {
	const accessToken = await getValidAccessToken();
	const preferences = getPreferenceValues<RadixPreferences>();
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	const url = `${getRadixApiBaseUrl(preferences)}${normalizedPath}`;

	const response = await fetch(url, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${accessToken}`,
		},
	});

	if (response.status === 401 || response.status === 403) {
		throw new AuthenticationRequiredError(
			"Radix rejected the stored credentials. Sign in again.",
		);
	}

	if (!response.ok) {
		const responseBody = await response.text();
		throw new RadixApiError(
			`Radix API request failed with ${response.status} ${response.statusText}`,
			response.status,
			responseBody,
		);
	}

	return (await response.json()) as T;
};

const mapWithConcurrency = async <Input, Output>(
	items: Input[],
	concurrency: number,
	mapper: (item: Input) => Promise<Output>,
) => {
	const results: Output[] = [];
	let nextIndex = 0;

	const workers = Array.from(
		{ length: Math.min(concurrency, items.length) },
		async () => {
			while (nextIndex < items.length) {
				const currentIndex = nextIndex;
				nextIndex += 1;
				results[currentIndex] = await mapper(items[currentIndex]);
			}
		},
	);

	await Promise.all(workers);
	return results;
};

const getJobSortTime = (job: RadixJobSummary) => {
	const timestamp = job.created || job.started || job.ended;
	return timestamp ? new Date(timestamp).getTime() || 0 : 0;
};

const extractCostValue = (value: unknown): number | string | undefined => {
	if (typeof value === "number" || typeof value === "string") {
		return value;
	}

	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as Record<string, unknown>;
	const directValue =
		record.cost ??
		record.totalCost ??
		record.estimatedCost ??
		record.monthlyCost ??
		record.futureCost ??
		record.value ??
		record.amount ??
		record.total;

	if (typeof directValue === "number" || typeof directValue === "string") {
		return directValue;
	}

	for (const nestedValue of Object.values(record)) {
		const extracted = extractCostValue(nestedValue);
		if (extracted !== undefined) {
			return extracted;
		}
	}

	return undefined;
};

const extractCostCurrency = (value: unknown): string | undefined => {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as Record<string, unknown>;
	const currency = record.currency ?? record.currencyCode;
	if (typeof currency === "string") {
		return currency;
	}

	for (const nestedValue of Object.values(record)) {
		const extracted = extractCostCurrency(nestedValue);
		if (extracted) {
			return extracted;
		}
	}

	return undefined;
};

const extractCostMetadata = (value: unknown) => {
	if (!value || typeof value !== "object") {
		return {};
	}

	const record = value as Record<string, unknown>;
	return {
		comment: getString(record.comment),
		costPercentageByCpu: getNumber(record.costPercentageByCpu),
		costPercentageByMemory: getNumber(record.costPercentageByMemory),
		creator: getString(record.creator),
		owner: getString(record.owner),
		wbs: getString(record.wbs),
	};
};

const getString = (value: unknown) => {
	return typeof value === "string" ? value : undefined;
};

const getNumber = (value: unknown) => {
	return typeof value === "number" ? value : undefined;
};

const getErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
};
