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
	type RadixApplicationSummary,
	RadixApiError,
	getApplicationOverview,
	getCurrentApiHost,
} from "./radix-api";
import {
	formatAliases,
	getApplicationDnsAliases,
	getApplicationExternalDnsAliases,
} from "./dns-aliases";

export default function Applications() {
	const host = getCurrentApiHost();
	const [isShowingDetail, setIsShowingDetail] = useState(false);
	const {
		data: applications = [],
		error,
		isLoading,
		revalidate,
	} = useCachedPromise(getApplicationOverview, [], {
		initialData: [],
		keepPreviousData: true,
		failureToastOptions: {
			title: "Could not load Radix applications",
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
			toast.message = "Loading applications";
			await revalidate();
		} catch (error) {
			toast.style = Toast.Style.Failure;
			toast.title = "Radix sign-in failed";
			toast.message = getErrorMessage(error);
		}
	}, [revalidate]);

	const signOut = useCallback(async () => {
		await signOutFromRadix();
		await showToast({
			style: Toast.Style.Success,
			title: "Signed out of Radix",
		});
		await revalidate();
	}, [revalidate]);

	const sortedApplications = useMemo(() => {
		return [...applications].sort((left, right) =>
			(left.name ?? "").localeCompare(right.name ?? ""),
		);
	}, [applications]);

	const isSignedOut = error instanceof AuthenticationRequiredError;
	const visibleError =
		error && !isSignedOut ? getErrorMessage(error) : undefined;

	return (
		<List
			isLoading={isLoading}
			isShowingDetail={isShowingDetail}
			searchBarPlaceholder="Search Radix applications..."
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
					title="Could not load Radix applications"
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

			{!isLoading && !error && sortedApplications.length === 0 ? (
				<List.EmptyView
					icon={Icon.Box}
					title="No Applications"
					description="No Radix applications were returned for this user"
					actions={
						<CommandActions onRefresh={revalidate} onSignOut={signOut} />
					}
				/>
			) : null}

			{sortedApplications.length > 0 ? (
				<List.Section title="Applications">
					{sortedApplications.map((application, index) => {
						const applicationId = application.name ?? `unnamed-${index}`;

						return (
							<List.Item
								key={applicationId}
								id={applicationId}
								icon={Icon.Box}
								title={application.name ?? "Unnamed application"}
								accessories={
									isShowingDetail
										? undefined
										: getApplicationAccessories(application)
								}
								detail={
									<List.Item.Detail
										key={applicationId}
										markdown={formatApplicationDetail(application, host)}
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
										openUrl={getApplicationConsoleUrl(application)}
										copyValue={JSON.stringify(application, null, 2)}
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
					title="Open Application"
					icon={Icon.Globe01}
					url={openUrl}
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

const getApplicationAccessories = (application: RadixApplicationSummary) => {
	return [
		{
			tag: {
				value: getApplicationCostLabel(application),
				color: Color.Blue,
			},
			icon: Icon.Coins,
		},
		{
			tag: {
				value: `${application.environments?.length ?? 0} env`,
				color: Color.Orange,
			},
			icon: Icon.Box,
		},
	];
};

const getApplicationCostLabel = (application: RadixApplicationSummary) => {
	const value = getApplicationCost(application);
	const currency = application.cost?.currency;

	if (value === undefined || value === null || value === "") {
		return "Cost -";
	}

	if (typeof value === "number") {
		return `Cost ${value.toLocaleString("en-GB", {
			maximumFractionDigits: 2,
			minimumFractionDigits: 2,
		})}${currency ? ` ${currency}` : ""}`;
	}

	return `Cost ${String(value)}${currency ? ` ${currency}` : ""}`;
};

const getApplicationCost = (application: RadixApplicationSummary) => {
	if (application.cost?.value !== undefined) {
		return application.cost.value;
	}

	const candidate = application as RadixApplicationSummary & {
		costEstimate?: unknown;
		monthlyCost?: unknown;
		estimatedCost?: unknown;
	};

	return (
		candidate.costEstimate ?? candidate.monthlyCost ?? candidate.estimatedCost
	);
};

const getApplicationConsoleUrl = (application: RadixApplicationSummary) => {
	if (!application.name) {
		return undefined;
	}

	return `https://console.radix.equinor.com/applications/${encodeURIComponent(application.name)}`;
};

const formatApplicationDetail = (
	application: RadixApplicationSummary,
	host: string,
) => {
	const dnsAliases = getApplicationDnsAliases(application);
	const externalDnsAliases = getApplicationExternalDnsAliases(application);

	return `# ${application.name ?? "Unnamed application"}

Host: \`${host}\`

DNS aliases: ${formatAliases(dnsAliases)}

External DNS aliases: ${formatAliases(externalDnsAliases)}

Cost: \`${getApplicationCostLabel(application)}\`

WBS: \`${application.cost?.wbs || "-"}\`

Owner: \`${application.cost?.owner || "-"}\`

Creator: \`${application.cost?.creator || "-"}\`

CPU cost: \`${formatPercentage(application.cost?.costPercentageByCpu)}\`

Memory cost: \`${formatPercentage(application.cost?.costPercentageByMemory)}\`

## Summary

- Environments: ${application.environments?.length ?? 0}
- Latest job: ${application.latestJob?.name ?? "-"}
- Latest job status: ${application.latestJob?.status ?? "-"}
- Latest pipeline: ${application.latestJob?.pipeline ?? "-"}
- Latest triggered by: ${application.latestJob?.triggeredBy ?? "-"}

## Raw

\`\`\`json
${JSON.stringify(application, null, 2)}
\`\`\``;
};

const formatPercentage = (value: number | undefined) => {
	if (value === undefined) {
		return "-";
	}

	return `${value.toLocaleString("en-GB", {
		maximumFractionDigits: 2,
		minimumFractionDigits: 2,
	})}%`;
};
