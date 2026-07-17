import { useCallback, useMemo, useState } from "react";
import { useCachedPromise } from "@raycast/utils";
import {
	Action,
	ActionPanel,
	Color,
	Icon,
	List,
	showToast,
	Toast,
} from "@vicinae/api";
import {
	AuthenticationRequiredError,
	signInToRadix,
	signOutFromRadix,
} from "./auth";
import {
	type EnvironmentListItem,
	type RadixComponentSummary,
	RadixApiError,
	getApplications,
	getCurrentApiHost,
	getEnvironmentOverview,
} from "./radix-api";
import {
	formatAliases,
	getEnvironmentDnsAliases,
	getEnvironmentExternalDnsAliases,
} from "./dns-aliases";

const ALL_APPLICATIONS = "__all__";

export default function Environments() {
	const host = getCurrentApiHost();
	const [selectedApplication, setSelectedApplication] =
		useState(ALL_APPLICATIONS);
	const selectedApplicationName =
		selectedApplication === ALL_APPLICATIONS ? undefined : selectedApplication;
	const [isShowingDetail, setIsShowingDetail] = useState(false);
	const {
		data: applications = [],
		error: applicationsError,
		isLoading: isLoadingApplications,
		revalidate: revalidateApplications,
	} = useCachedPromise(getApplications, [], {
		initialData: [],
		keepPreviousData: true,
		failureToastOptions: {
			title: "Could not load Radix applications",
		},
	});
	const {
		data: result,
		error,
		isLoading,
		revalidate,
	} = useCachedPromise(getEnvironmentOverview, [selectedApplicationName], {
		initialData: { applications: [], environments: [], failedApplications: [] },
		keepPreviousData: true,
		failureToastOptions: {
			title: "Could not load Radix environments",
		},
	});

	const signIn = useCallback(async () => {
		const toast = await showToast({
			style: Toast.Style.Animated,
			title: "Signing in to Radix",
			message: "Continue in your browser",
		});

		try {
			await signInToRadix();
			toast.style = Toast.Style.Success;
			toast.title = "Signed in to Radix";
			toast.message = "Loading environments";
			await revalidateApplications();
			await revalidate();
		} catch (error) {
			toast.style = Toast.Style.Failure;
			toast.title = "Radix sign-in failed";
			toast.message = getErrorMessage(error);
		}
	}, [revalidate, revalidateApplications]);

	const signOut = useCallback(async () => {
		await signOutFromRadix();
		await showToast({
			style: Toast.Style.Success,
			title: "Signed out of Radix",
		});
		await revalidateApplications();
		await revalidate();
	}, [revalidate, revalidateApplications]);

	const applicationOptions = useMemo(() => {
		return applications
			.map((application) => application.name)
			.filter((name): name is string => Boolean(name))
			.sort((left, right) => left.localeCompare(right));
	}, [applications]);

	const environments = useMemo(() => {
		return result.environments;
	}, [result.environments]);

	const failedApplications = result.failedApplications;

	const firstError = error ?? applicationsError;
	const isSignedOut = firstError instanceof AuthenticationRequiredError;
	const visibleError =
		firstError && !isSignedOut ? getErrorMessage(firstError) : undefined;

	return (
		<List
			isLoading={isLoading}
			isShowingDetail={isShowingDetail}
			searchBarAccessory={
				<List.Dropdown
					tooltip="Filter Application"
					value={selectedApplication}
					onChange={setSelectedApplication}
					isLoading={isLoadingApplications}
				>
					<List.Dropdown.Item title="All" value={ALL_APPLICATIONS} />
					<List.Dropdown.Section title="Applications">
						{applicationOptions.map((application) => (
							<List.Dropdown.Item
								key={application}
								title={application}
								value={application}
							/>
						))}
					</List.Dropdown.Section>
				</List.Dropdown>
			}
			searchBarPlaceholder="Search Radix environments..."
		>
			{isSignedOut ? (
				<List.EmptyView
					icon={Icon.Lock}
					title="Sign in to Radix"
					description={`Connect to ${host}`}
					actions={<SignInActions onSignIn={signIn} />}
				/>
			) : null}

			{visibleError ? (
				<List.EmptyView
					icon={Icon.Warning}
					title="Could not load Radix environments"
					description={visibleError}
					actions={
						<CommandActions
							onRefresh={revalidate}
							onSignIn={signIn}
							onSignOut={signOut}
						/>
					}
				/>
			) : null}

			{!isLoading && !error && environments.length === 0 ? (
				<List.EmptyView
					icon={Icon.Box}
					title="No Environments"
					description={
						selectedApplicationName
							? "No environments found for this application"
							: "Choose an application or configure default applications in preferences"
					}
					actions={
						<CommandActions onRefresh={revalidate} onSignOut={signOut} />
					}
				/>
			) : null}

			{failedApplications.length > 0 ? (
				<List.Section title="Partial Results">
					{failedApplications.map((failure) => (
						<List.Item
							key={failure.applicationName}
							icon={Icon.Warning}
							title={failure.applicationName}
							subtitle={failure.message}
							actions={
								<CommandActions onRefresh={revalidate} onSignOut={signOut} />
							}
						/>
					))}
				</List.Section>
			) : null}

			{environments.length > 0 ? (
				<List.Section title="Environments">
					{environments.map((environment) => {
						const environmentId = getEnvironmentId(environment);

						return (
							<List.Item
								key={environmentId}
								id={environmentId}
								icon={getEnvironmentStatusImage(environment)}
								title={environment.applicationName}
								accessories={
									isShowingDetail
										? undefined
										: getEnvironmentAccessories(environment)
								}
								detail={
									<List.Item.Detail
										key={environmentId}
										markdown={formatEnvironmentDetail(environment, host)}
									/>
								}
								actions={
									<CommandActions
										onRefresh={revalidate}
										onSignOut={signOut}
										onToggleDetails={() =>
											setIsShowingDetail((value) => !value)
										}
										isShowingDetail={isShowingDetail}
										deploymentUrls={getDeploymentUrls(environment)}
										copyValue={JSON.stringify(environment, null, 2)}
									/>
								}
							/>
						);
					})}
				</List.Section>
			) : null}
		</List>
	);
}

const SignInActions = ({ onSignIn }: { onSignIn: () => void }) => {
	return (
		<ActionPanel>
			<Action title="Sign in to Radix" icon={Icon.Key} onAction={onSignIn} />
		</ActionPanel>
	);
};

const CommandActions = ({
	onRefresh,
	onSignIn,
	onSignOut,
	onToggleDetails,
	isShowingDetail,
	deploymentUrls,
	copyValue,
}: {
	onRefresh: () => void;
	onSignIn?: () => void;
	onSignOut: () => void;
	onToggleDetails?: () => void;
	isShowingDetail?: boolean;
	deploymentUrls?: DeploymentUrl[];
	copyValue?: string;
}) => {
	return (
		<ActionPanel>
			{deploymentUrls?.[0] ? (
				<Action.OpenInBrowser
					title={`Open ${deploymentUrls[0].componentName}`}
					icon={Icon.Globe01}
					url={deploymentUrls[0].url}
				/>
			) : null}
			{onToggleDetails ? (
				<Action
					title={isShowingDetail ? "Hide Details" : "Show Details"}
					icon={Icon.AppWindowSidebarRight}
					shortcut={{ modifiers: ["shift"], key: "enter" }}
					onAction={onToggleDetails}
				/>
			) : null}
			{deploymentUrls?.[0] ? (
				<Action.CopyToClipboard
					title={`Copy ${deploymentUrls[0].componentName} URL`}
					icon={Icon.CopyClipboard}
					content={deploymentUrls[0].url}
				/>
			) : null}
			<Action
				title="Refresh"
				icon={Icon.ArrowClockwise}
				shortcut={{ modifiers: ["ctrl"], key: "r" }}
				onAction={onRefresh}
			/>
			{copyValue ? (
				<Action.CopyToClipboard title="Copy Value" content={copyValue} />
			) : null}
			{onSignIn ? (
				<Action title="Sign in Again" icon={Icon.Key} onAction={onSignIn} />
			) : null}
			<Action
				title="Sign out"
				icon={Icon.Logout}
				style={Action.Style.Destructive}
				onAction={onSignOut}
			/>
		</ActionPanel>
	);
};

const getErrorMessage = (error: unknown) => {
	if (error instanceof RadixApiError && error.responseBody) {
		return `${error.message}: ${error.responseBody}`;
	}

	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
};

const getEnvironmentId = (environment: EnvironmentListItem) => {
	return [environment.applicationName, environment.name]
		.filter(Boolean)
		.join(":");
};

const getEnvironmentAccessories = (environment: EnvironmentListItem) => {
	const activeDeployment = environment.activeDeployment;
	const accessories = [
		{
			tag: {
				value: environment.name || "Environment",
				color: Color.Orange,
			},
			icon: Icon.Box,
		},
		{
			tag: {
				value: getGitRefLabel(environment),
				color: getGitRefColor(activeDeployment?.gitRefType),
			},
			icon: Icon.CodeBlock,
		},
		{
			tag: {
				value: getDeploymentStatus(environment),
				color: getDeploymentStatusColor(getDeploymentStatus(environment)),
			},
			icon: getDeploymentStatusIcon(getDeploymentStatus(environment)),
		},
	];

	return accessories;
};

const getEnvironmentStatusImage = (environment: EnvironmentListItem) => {
	const status = getDeploymentStatus(environment);
	return {
		source: getDeploymentStatusIcon(status),
		tintColor: getDeploymentStatusColor(status),
	};
};

const getDeploymentStatus = (environment: EnvironmentListItem) => {
	return environment.activeDeployment?.status || environment.status || "Down";
};

const getDeploymentStatusIcon = (status: string | undefined) => {
	switch (status) {
		case "Ready":
		case "Consistent":
			return Icon.CheckCircle;
		case "Reconciling":
			return Icon.ArrowClockwise;
		case "Failed":
		case "Orphan":
			return Icon.Warning;
		case "Inactive":
		case "Pending":
		case "Down":
			return Icon.Clock;
		default:
			return Icon.Bolt;
	}
};

const getDeploymentStatusColor = (status: string | undefined) => {
	switch (status) {
		case "Ready":
		case "Consistent":
			return Color.Green;
		case "Reconciling":
			return Color.Yellow;
		case "Failed":
		case "Orphan":
			return Color.Red;
		case "Inactive":
		case "Pending":
		case "Down":
			return Color.Orange;
		default:
			return Color.SecondaryText;
	}
};

const getGitRefLabel = (environment: EnvironmentListItem) => {
	const deployment = environment.activeDeployment;
	if (deployment?.gitRef) {
		const gitRefType = deployment.gitRefType || "ref";
		return `${gitRefType}: ${deployment.gitRef}`;
	}

	if (deployment?.builtFromBranch) {
		return `branch: ${deployment.builtFromBranch}`;
	}

	if (environment.branchMapping) {
		return `branch: ${environment.branchMapping}`;
	}

	return "No ref";
};

const getGitRefColor = (gitRefType: string | undefined) => {
	switch (gitRefType) {
		case "tag":
			return Color.Magenta;
		case "branch":
			return Color.Purple;
		default:
			return Color.SecondaryText;
	}
};

type DeploymentUrl = {
	componentName: string;
	url: string;
};

const getDeploymentUrls = (
	environment: EnvironmentListItem,
): DeploymentUrl[] => {
	if (!environment.name) {
		return [];
	}

	return getOpenableComponents(environment)
		.map((component) => component.name)
		.filter((componentName): componentName is string => Boolean(componentName))
		.map((componentName) => ({
			componentName,
			url: `https://${componentName}-${environment.applicationName}-${environment.name}.radix.equinor.com`,
		}));
};

const getOpenableComponents = (environment: EnvironmentListItem) => {
	return [...(environment.activeDeployment?.components ?? [])]
		.filter((component) => component.name && !component.skipDeployment)
		.sort(
			(left, right) => getComponentPriority(left) - getComponentPriority(right),
		);
};

const getComponentPriority = (component: RadixComponentSummary) => {
	if (component.ports?.some((port) => port.isPublic)) {
		return 0;
	}

	if (component.externalDNS?.length) {
		return 1;
	}

	if (component.type === "component") {
		return 2;
	}

	return 3;
};

const formatDate = (value: string | undefined) => {
	if (!value) {
		return "-";
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}

	return date.toLocaleString("en-GB", {
		day: "2-digit",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
};

const formatEnvironmentDetail = (
	environment: EnvironmentListItem,
	host: string,
) => {
	const deployment = environment.activeDeployment;
	const dnsAliases = getEnvironmentDnsAliases(environment);
	const externalDnsAliases = getEnvironmentExternalDnsAliases(environment);

	return `# ${environment.applicationName}

Environment: \`${environment.name || "-"}\`

Status: \`${getDeploymentStatus(environment)}\`

Git ref: \`${getGitRefLabel(environment)}\`

Host: \`${host}\`

DNS aliases: ${formatAliases(dnsAliases)}

External DNS aliases: ${formatAliases(externalDnsAliases)}

Deployment: \`${deployment?.name || "-"}\`

## Active Deployment

- Deployment status: ${deployment?.status || "-"}
- Pipeline: ${deployment?.pipelineJobType || "-"}
- Built from branch: ${deployment?.builtFromBranch || "-"}
- Git ref type: ${deployment?.gitRefType || "-"}
- Git ref: ${deployment?.gitRef || "-"}
- Git tags: ${deployment?.gitTags || "-"}
- Commit: ${deployment?.commitID || deployment?.gitCommitHash || "-"}
- Active from: ${formatDate(deployment?.activeFrom)}

## Raw

\`\`\`json
${JSON.stringify(environment, null, 2)}
\`\`\``;
};
