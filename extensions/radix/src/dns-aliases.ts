import type {
	EnvironmentListItem,
	PipelineJobListItem,
	RadixApplicationSummary,
	RadixComponentSummary,
	RadixDeploymentSummary,
	RadixEnvironmentSummary,
} from "./radix-api";

const DNS_ALIAS_FIELDS = ["dnsAliases", "dnsAlias"];
const EXTERNAL_DNS_ALIAS_FIELDS = [
	"dnsExternalAliases",
	"externalDNS",
	"externalDns",
	"externalDNSAliases",
	"externalDnsAliases",
];
const ALIAS_VALUE_FIELDS = [
	"url",
	"alias",
	"fqdn",
	"host",
	"hostname",
	"dnsName",
];

export const getApplicationDnsAliases = (
	application: RadixApplicationSummary,
) => {
	return collectApplicationAliases(application, DNS_ALIAS_FIELDS);
};

export const getApplicationExternalDnsAliases = (
	application: RadixApplicationSummary,
) => {
	return collectApplicationAliases(application, EXTERNAL_DNS_ALIAS_FIELDS);
};

export const getEnvironmentDnsAliases = (
	environment: RadixEnvironmentSummary | EnvironmentListItem,
) => {
	return collectEnvironmentAliases(environment, DNS_ALIAS_FIELDS);
};

export const getEnvironmentExternalDnsAliases = (
	environment: RadixEnvironmentSummary | EnvironmentListItem,
) => {
	return collectEnvironmentAliases(environment, EXTERNAL_DNS_ALIAS_FIELDS);
};

export const getPipelineJobDnsAliases = (job: PipelineJobListItem) => {
	return collectJobAliases(job, DNS_ALIAS_FIELDS);
};

export const getPipelineJobExternalDnsAliases = (job: PipelineJobListItem) => {
	return collectJobAliases(job, EXTERNAL_DNS_ALIAS_FIELDS);
};

export const formatAliases = (aliases: string[]) => {
	return aliases.length > 0 ? aliases.map(formatAliasLink).join(", ") : "-";
};

const collectApplicationAliases = (
	application: RadixApplicationSummary,
	fieldNames: string[],
	environmentName?: string,
) => {
	const aliases = new Set<string>();
	collectAliasesFromRecord(application, fieldNames, aliases, environmentName);

	for (const environment of application.environments ?? []) {
		if (environmentName && environment.name !== environmentName) {
			continue;
		}

		collectEnvironmentAliasesInto(environment, fieldNames, aliases);
	}

	return sortAliases(aliases);
};

const collectEnvironmentAliases = (
	environment: RadixEnvironmentSummary | EnvironmentListItem,
	fieldNames: string[],
) => {
	const aliases = new Set<string>();
	collectEnvironmentAliasesInto(environment, fieldNames, aliases);

	const application =
		"application" in environment ? environment.application : undefined;
	if (application) {
		for (const alias of collectApplicationAliases(
			application,
			fieldNames,
			environment.name,
		)) {
			aliases.add(alias);
		}
	}

	return sortAliases(aliases);
};

const collectJobAliases = (job: PipelineJobListItem, fieldNames: string[]) => {
	const aliases = new Set<string>();
	collectAliasesFromRecord(job, fieldNames, aliases);

	if (!job.application) {
		return sortAliases(aliases);
	}

	const environmentNames = getJobEnvironmentNames(job);
	if (environmentNames.length === 0) {
		for (const alias of collectApplicationAliases(
			job.application,
			fieldNames,
		)) {
			aliases.add(alias);
		}
		return sortAliases(aliases);
	}

	for (const environmentName of environmentNames) {
		for (const alias of collectApplicationAliases(
			job.application,
			fieldNames,
			environmentName,
		)) {
			aliases.add(alias);
		}
	}

	return sortAliases(aliases);
};

const collectEnvironmentAliasesInto = (
	environment: RadixEnvironmentSummary,
	fieldNames: string[],
	aliases: Set<string>,
) => {
	collectAliasesFromRecord(environment, fieldNames, aliases);
	collectDeploymentAliases(environment.activeDeployment, fieldNames, aliases);
};

const collectDeploymentAliases = (
	deployment: RadixDeploymentSummary | undefined,
	fieldNames: string[],
	aliases: Set<string>,
) => {
	if (!deployment) {
		return;
	}

	collectAliasesFromRecord(deployment, fieldNames, aliases);

	for (const component of deployment.components ?? []) {
		collectComponentAliases(component, fieldNames, aliases);
	}
};

const collectComponentAliases = (
	component: RadixComponentSummary,
	fieldNames: string[],
	aliases: Set<string>,
) => {
	collectAliasesFromRecord(component, fieldNames, aliases);
};

const collectAliasesFromRecord = (
	source: unknown,
	fieldNames: string[],
	aliases: Set<string>,
	environmentName?: string,
) => {
	if (!source || typeof source !== "object") {
		return;
	}

	const record = source as Record<string, unknown>;

	for (const fieldName of fieldNames) {
		collectAliasesFromValue(record[fieldName], aliases, environmentName);
	}
};

const collectAliasesFromValue = (
	value: unknown,
	aliases: Set<string>,
	environmentName?: string,
) => {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectAliasesFromValue(item, aliases, environmentName);
		}
		return;
	}

	if (!matchesEnvironment(value, environmentName)) {
		return;
	}

	const alias = getAliasValue(value);
	if (alias) {
		aliases.add(alias);
	}
};

const getAliasValue = (value: unknown) => {
	if (typeof value === "string") {
		return value.trim() || undefined;
	}

	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as Record<string, unknown>;
	for (const fieldName of ALIAS_VALUE_FIELDS) {
		const fieldValue = record[fieldName];
		if (typeof fieldValue === "string" && fieldValue.trim()) {
			return fieldValue.trim();
		}
	}

	return undefined;
};

const matchesEnvironment = (
	value: unknown,
	environmentName: string | undefined,
) => {
	if (!environmentName || !value || typeof value !== "object") {
		return true;
	}

	const record = value as Record<string, unknown>;
	const valueEnvironmentName = record.environmentName ?? record.environment;
	return (
		typeof valueEnvironmentName !== "string" ||
		valueEnvironmentName === environmentName
	);
};

const getJobEnvironmentNames = (job: PipelineJobListItem) => {
	return [
		...(job.environments ?? []),
		job.promotedFromEnvironment,
		job.promotedToEnvironment,
	]
		.filter((environmentName): environmentName is string =>
			Boolean(environmentName),
		)
		.filter(
			(environmentName, index, environmentNames) =>
				environmentNames.indexOf(environmentName) === index,
		);
};

const sortAliases = (aliases: Set<string>) => {
	return [...aliases].sort((left, right) => left.localeCompare(right));
};

const formatAliasLink = (alias: string) => {
	return `[${escapeMarkdownLinkText(alias)}](${getAliasUrl(alias)})`;
};

const getAliasUrl = (alias: string) => {
	if (/^https?:\/\//i.test(alias)) {
		return alias;
	}

	return `https://${alias}`;
};

const escapeMarkdownLinkText = (value: string) => {
	return value.replace(/([\\[\]])/g, "\\$1");
};
