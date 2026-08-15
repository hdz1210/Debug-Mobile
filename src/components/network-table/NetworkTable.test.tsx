import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NetworkFlow } from "../../types/events";
import { NetworkTable } from "./NetworkTable";

const firebaseFlow: NetworkFlow = {
  id: "firebase-flow",
  method: "POST",
  url: "https://app-measurement.com/a?app=com.example",
  path: "/a?app=com.example",
  host: "app-measurement.com",
  websocketMessages: [],
  state: "completed",
  analysis: {
    providerId: "firebase",
    providerLabel: "Firebase",
    serviceId: "analytics",
    serviceLabel: "Analytics",
    protocol: "firebase-native",
    confidence: 0.99,
    status: "decoded",
    parserVersion: "1",
    tags: ["firebase", "analytics"],
    bundles: [],
    warnings: [],
  },
};

const apiFlow: NetworkFlow = {
  id: "api-flow",
  method: "GET",
  url: "https://api.example.com/profile",
  path: "/profile",
  host: "api.example.com",
  websocketMessages: [],
  state: "completed",
};

type ElementProps = {
  children?: ReactNode;
  [key: string]: unknown;
};

function findElements(
  node: ReactNode,
  predicate: (element: ReactElement<ElementProps>) => boolean,
): Array<ReactElement<ElementProps>> {
  if (!isValidElement<ElementProps>(node)) return [];

  const matches = predicate(node) ? [node] : [];
  Children.forEach(node.props.children, (child) => {
    matches.push(...findElements(child, predicate));
  });
  return matches;
}

describe("NetworkTable", () => {
  it("keeps the raw path and badge while rendering selection/export controls", () => {
    const html = renderToStaticMarkup(
      <NetworkTable
        flows={[firebaseFlow, apiFlow]}
        totalFlowCount={3}
        selectedFlowId={null}
        checkedFlowIds={new Set([firebaseFlow.id])}
        isExporting={false}
        onSelect={() => undefined}
        onToggleChecked={() => undefined}
        onToggleAllVisible={() => undefined}
        onExportSelected={() => undefined}
        onExportAll={() => undefined}
      />,
    );

    expect(html).toContain("/a?app=com.example");
    expect(html).toContain("Firebase Analytics");
    expect(html).toContain('data-service="analytics"');
    expect(html).toContain("2 of 3 shown");
    expect(html).toContain("Export selected (1)");
    expect(html).toContain("Export all (3)");
    expect(html).toContain('aria-label="Select all visible requests"');
    expect(html).toContain('aria-checked="mixed"');
    expect(html).toContain(
      'aria-label="Select request /a?app=com.example" checked=""',
    );
  });

  it("disables export and selection controls while exporting", () => {
    const html = renderToStaticMarkup(
      <NetworkTable
        flows={[firebaseFlow]}
        totalFlowCount={1}
        selectedFlowId={null}
        checkedFlowIds={new Set([firebaseFlow.id])}
        isExporting
        onSelect={() => undefined}
        onToggleChecked={() => undefined}
        onToggleAllVisible={() => undefined}
        onExportSelected={() => undefined}
        onExportAll={() => undefined}
      />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html.match(/disabled=""/g)).toHaveLength(4);
  });

  it("stops checkbox clicks from selecting the detail row", () => {
    const onSelect = vi.fn();
    const onToggleChecked = vi.fn();
    const stopPropagation = vi.fn();
    const tree = NetworkTable({
      flows: [firebaseFlow],
      totalFlowCount: 1,
      selectedFlowId: null,
      checkedFlowIds: new Set(),
      isExporting: false,
      onSelect,
      onToggleChecked,
      onToggleAllVisible: vi.fn(),
      onExportSelected: vi.fn(),
      onExportAll: vi.fn(),
    });
    const checkbox = findElements(
      tree,
      (element) =>
        element.type === "input" &&
        element.props["aria-label"] === "Select request /a?app=com.example",
    )[0];

    expect(checkbox).toBeDefined();
    const onClick = checkbox.props.onClick as (event: {
      stopPropagation: () => void;
    }) => void;
    const onChange = checkbox.props.onChange as (event: {
      currentTarget: { checked: boolean };
    }) => void;
    onClick({ stopPropagation });
    onChange({ currentTarget: { checked: true } });

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onToggleChecked).toHaveBeenCalledWith(firebaseFlow.id, true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("disables empty-state export controls and spans all table columns", () => {
    const html = renderToStaticMarkup(
      <NetworkTable
        flows={[]}
        totalFlowCount={0}
        selectedFlowId={null}
        checkedFlowIds={new Set()}
        isExporting={false}
        onSelect={() => undefined}
        onToggleChecked={() => undefined}
        onToggleAllVisible={() => undefined}
        onExportSelected={() => undefined}
        onExportAll={() => undefined}
      />,
    );

    expect(html).toContain("Export selected (0)");
    expect(html).toContain("Export all (0)");
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain('colSpan="8"');
  });
});
