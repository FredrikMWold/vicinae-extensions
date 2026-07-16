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
	name?: string;
	environments?: RadixEnvironmentSummary[];
	latestJob?: RadixJobSummary;
};

export type RadixExternalDns = {
	fqdn?: string;
};

export type RadixPort = {
	isPublic?: boolean;
	name?: string;
	port?: number;
};

export type RadixComponentSummary = {
	commitID?: string;
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
	environment?: string;
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
	applicationName: string;
};

export type PipelineJobsResult = {
	applications: RadixApplicationSummary[];
	jobs: PipelineJobListItem[];
	failedApplications: Array<{ applicationName: string; message: string }>;
};

export type EnvironmentListItem = RadixEnvironmentSummary & {
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
				const environmentSummaries =
					await getApplicationEnvironments(applicationName);
				const environments = await mapWithConcurrency(
					environmentSummaries,
					6,
					async (environment) => {
						if (!environment.name) {
							return environment;
						}

						try {
							return await getApplicationEnvironment(
								applicationName,
								environment.name,
							);
						} catch {
							return environment;
						}
					},
				);

				return {
					applicationName,
					environments: environments.map((environment) => ({
						...environment,
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
				const jobs = await getApplicationJobs(applicationName);
				return {
					applicationName,
					jobs: jobs.map((job) => ({
						...job,
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

const getErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
};
