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
	type PipelineJobListItem,
	getApplications,
	getCurrentApiHost,
	getPipelineJobsForAllApplications,
	RadixApiError,
} from "./radix-api";

const ALL_APPLICATIONS = "__all__";

export default function PipelineJobs() {
	const host = getCurrentApiHost();
	const [isShowingDetail, setIsShowingDetail] = useState(false);
	const [selectedApplication, setSelectedApplication] =
		useState(ALL_APPLICATIONS);
	const selectedApplicationName =
		selectedApplication === ALL_APPLICATIONS ? undefined : selectedApplication;
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
	} = useCachedPromise(
		getPipelineJobsForAllApplications,
		[selectedApplicationName],
		{
			initialData: {
				applications: [],
				jobs: [],
				failedApplications: [],
			},
			keepPreviousData: true,
			failureToastOptions: {
				title: "Could not load Radix pipeline jobs",
			},
		},
	);

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
			toast.message = "Loading pipeline jobs";
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

	const jobs = useMemo(() => {
		return result?.jobs ?? [];
	}, [result]);

	const failedApplications = result?.failedApplications ?? [];
	const applicationOptions = useMemo(() => {
		return applications
			.map((application) => application.name)
			.filter((name): name is string => Boolean(name))
			.sort((left, right) => left.localeCompare(right));
	}, [applications]);
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
			searchBarPlaceholder="Search Radix pipeline jobs..."
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
					title="Could not load Radix data"
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

			{!isLoading &&
			!error &&
			jobs.length === 0 &&
			failedApplications.length === 0 ? (
				<List.EmptyView
					icon={Icon.Box}
					title="No Pipeline Jobs"
					description={`Checked ${result?.applications.length ?? 0} applications`}
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

			{jobs.length > 0 ? (
				<List.Section title="Pipeline Jobs">
					{jobs.map((job, index) => {
						const jobId = getJobId(job, index);

						return (
							<List.Item
								key={jobId}
								id={jobId}
								icon={getStatusImage(job.status)}
								title={getJobTitle(job, jobId)}
								subtitle={formatPipelineName(job.pipeline)}
								accessories={getJobAccessories(job)}
								detail={
									<List.Item.Detail
										key={jobId}
										markdown={formatJobDetail(job, host)}
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
										openUrl={getPipelineJobConsoleUrl(job)}
										copyValue={JSON.stringify(job, null, 2)}
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
	openUrl,
	copyValue,
}: {
	onRefresh: () => void;
	onSignIn?: () => void;
	onSignOut: () => void;
	onToggleDetails?: () => void;
	isShowingDetail?: boolean;
	openUrl?: string;
	copyValue?: string;
}) => {
	return (
		<ActionPanel>
			{openUrl ? (
				<Action.OpenInBrowser
					title="Open Pipeline Job"
					icon={Icon.Globe01}
					url={openUrl}
				/>
			) : null}
			<Action title="Refresh" icon={Icon.ArrowClockwise} onAction={onRefresh} />
			{onToggleDetails ? (
				<Action
					title={isShowingDetail ? "Hide Details" : "Show Details"}
					icon={Icon.AppWindowSidebarRight}
					onAction={onToggleDetails}
				/>
			) : null}
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

const getJobTitle = (job: PipelineJobListItem, jobId: string) => {
	return `${job.applicationName}${toZeroWidthSuffix(jobId)}`;
};

const getJobId = (job: PipelineJobListItem, index: number) => {
	return [
		job.applicationName,
		job.name,
		job.created,
		job.started,
		job.pipeline,
		job.gitRef || job.branch,
		index,
	]
		.filter(Boolean)
		.join(":");
};

const getPipelineJobConsoleUrl = (job: PipelineJobListItem) => {
	if (!job.name) {
		return undefined;
	}

	const applicationName = encodeURIComponent(job.applicationName);
	const jobName = encodeURIComponent(job.name);
	return `https://console.radix.equinor.com/applications/${applicationName}/jobs/view/${jobName}`;
};

const toZeroWidthSuffix = (value: string) => {
	return Array.from(value)
		.map((character) => character.charCodeAt(0).toString(2).padStart(8, "0"))
		.join("")
		.replace(/0/g, "\u200b")
		.replace(/1/g, "\u200c");
};

const getJobAccessories = (job: PipelineJobListItem) => {
	const accessories = [
		{
			tag: {
				value: getTriggerLabel(job.triggeredBy),
				color: Color.Purple,
			},
			icon: Icon.Person,
		},
		{
			tag: {
				value: formatDate(job.created || job.started),
				color: Color.Blue,
			},
			icon: Icon.Calendar,
		},
	];

	const deployment = getDeploymentLabel(job);
	if (deployment) {
		accessories.unshift({
			tag: {
				value: deployment,
				color: Color.Orange,
			},
			icon: Icon.Box,
		});
	}

	return accessories;
};

const getDeploymentLabel = (job: PipelineJobListItem) => {
	if (job.promotedFromDeployment) {
		return job.promotedFromDeployment;
	}

	if (job.environments?.length) {
		return job.environments.join(", ");
	}

	if (job.promotedFromEnvironment || job.promotedToEnvironment) {
		return [job.promotedFromEnvironment, job.promotedToEnvironment]
			.filter(Boolean)
			.join(" -> ");
	}

	return undefined;
};

const getStatusImage = (status: string | undefined) => {
	return {
		source: getStatusIcon(status),
		tintColor: getStatusColor(status),
	};
};

const getStatusIcon = (status: string | undefined) => {
	switch (status) {
		case "Succeeded":
			return Icon.CheckCircle;
		case "Failed":
		case "Stopped":
		case "StoppedNoChanges":
			return Icon.Warning;
		case "Running":
		case "Stopping":
			return Icon.ArrowClockwise;
		case "Queued":
		case "Waiting":
			return Icon.Clock;
		default:
			return Icon.Bolt;
	}
};

const getStatusColor = (status: string | undefined) => {
	switch (status) {
		case "Succeeded":
			return Color.Green;
		case "Failed":
			return Color.Red;
		case "Stopped":
		case "StoppedNoChanges":
			return Color.Red;
		case "Running":
			return Color.Yellow;
		case "Stopping":
		case "Queued":
		case "Waiting":
			return Color.Orange;
		default:
			return Color.SecondaryText;
	}
};

const getTriggerLabel = (triggeredBy: string | undefined) => {
	if (!triggeredBy) {
		return "Unknown";
	}

	const [name] = triggeredBy.split("@");
	return name || triggeredBy;
};

const formatPipelineName = (pipeline: string | undefined) => {
	if (!pipeline) {
		return "Pipeline";
	}

	return pipeline
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
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

const formatJobDetail = (job: PipelineJobListItem, host: string) => {
	return `# ${job.applicationName}

Status: \`${job.status || "Unknown"}\`

Pipeline: \`${formatPipelineName(job.pipeline)}\`

Deployment: \`${getDeploymentLabel(job) || "-"}\`

Host: \`${host}\`

## Job

- Name: ${job.name || "-"}
- Git ref: ${job.gitRef || job.branch || "-"}
- Commit: ${job.commitID || "-"}
- Triggered by: ${job.triggeredBy || "-"}
- Created: ${formatDate(job.created)}
- Started: ${formatDate(job.started)}
- Ended: ${formatDate(job.ended)}

## Raw

\`\`\`json
${JSON.stringify(job, null, 2)}
\`\`\``;
};
