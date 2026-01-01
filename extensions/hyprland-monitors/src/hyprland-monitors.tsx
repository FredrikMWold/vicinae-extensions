import {
  Action,
  ActionPanel,
  Color,
  Detail,
  List,
  useNavigation,
} from "@vicinae/api";
import { MonitorSettings } from "./MonitorSettings";
import { noHyprlandErrorMessage } from "./noHyprlandErrorMessage";
import { buildMonitorRule, getMonitors } from "./api/monitor";
import { useState } from "react";
import { getIsHyprlandInstalled } from "./utils/getIsHyprlandInstalled";
import { PERSIST_CHANGES } from "./config";
import { getIsPersistSetup, setupPersistConfig } from "./api/hyprlandConfig";

const hyprlandInstalled = getIsHyprlandInstalled();

export default function HyperlandMonitors() {
  const [monitors, setMonitors] = useState<Monitor[]>(getMonitors());
  const [isPersistSetup, setIsPersistSetup] = useState(getIsPersistSetup());
  const { push } = useNavigation();
  if (!hyprlandInstalled) {
    return <Detail markdown={noHyprlandErrorMessage} />;
  }
  if (PERSIST_CHANGES && !isPersistSetup) {
    return (
      <Detail
        actions={
          <ActionPanel>
            <Action
              title="Open Setup Guide"
              onAction={() => {
                setupPersistConfig();
                setIsPersistSetup(true);
              }}
            />
          </ActionPanel>
        }
        markdown={`# Hyprland Monitor Setup Required

Persistent monitor changes are enabled, but setup is not complete yet.

Press **Enter** to let Vicinae set this up automatically.

This will:
- Create the required Hyprland config file
- Source the config so changes apply immediately`}
      />
    );
  }
  return (
    <List searchBarPlaceholder="Monitors...">
      <List.Section title="Monitors">
        {monitors.map((monitor) => (
          <List.Item
            key={buildMonitorRule(monitor)}
            title={monitor.description}
            keywords={[monitor.description]}
            actions={
              <ActionPanel>
                <Action
                  title="Select"
                  onAction={() =>
                    push(
                      <MonitorSettings
                        monitor={monitor}
                        refreshParent={() => setMonitors(getMonitors())}
                      />,
                    )
                  }
                />
              </ActionPanel>
            }
            accessories={[
              {
                text: {
                  value: `${monitor.width}x${monitor.height}`,
                  color: Color.Green,
                },
              },
              {
                text: { value: `${monitor.refreshRate}Hz`, color: Color.Blue },
              },
            ]}
          />
        ))}
      </List.Section>
    </List>
  );
}

export type Monitor = {
  id: number;
  description: string;
  name: string;
  width: number;
  height: number;
  scale: number;
  transform: number;
  position: string;
  mode: string;
  refreshRate: number;
  availableModes: string[];
};
