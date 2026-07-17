import { Detail } from "@vicinae/api";

export const NpmTerminalUsageDetails = () => {
  return (
    <Detail
      markdown={`# Run this from your terminal

This command needs a project directory and should be launched from the terminal context.

## Suggested aliases for ~/.bashrc

\`\`\`bash
alias npmi='vicinae cmd launch @FredrikMWold/npm:npm-install'
alias npmr='vicinae cmd launch @FredrikMWold/npm:npm-uninstall'
alias npmu='vicinae cmd launch @FredrikMWold/npm:npm-update'
\`\`\``}
    />
  );
};
