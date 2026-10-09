// Phần "Tóm tắt hoạt động" trên thẻ ngày: tổng giờ + cây Project › Subproject › task gợi ý, sẵn sàng tạo task.
import { useMemo, type ReactNode } from "react";
import { Tree, Tag, Button, Tooltip, Typography, Space } from "antd";
import { FolderOutlined, QuestionCircleOutlined, PlusOutlined, CheckOutlined, ExpandOutlined, DeleteOutlined, FundViewOutlined } from "@ant-design/icons";
import type { StoredDaySummary, SummaryRow } from "./activitySummaryStore";

const { Text } = Typography;

interface Props {
  summary: StoredDaySummary;
  projects: any[];
  onCreateRows: (rows: SummaryRow[]) => void;
  onOpen: () => void;
  onRemove: () => void;
}

interface Node {
  key: string;
  title: ReactNode;
  hours: number;
  children: Node[];
}

export default function DaySummaryTree({ summary, projects, onCreateRows, onOpen, onRemove }: Props) {
  const pendingRows = summary.rows.filter((r) => !r.added);
  const pendingHours = pendingRows.reduce((s, r) => s + r.hours, 0);
  const totalHours = summary.rows.reduce((s, r) => s + r.hours, 0);

  const treeData = useMemo(() => {
    const byName = new Map<string, any>(projects.map((p) => [p.name, p]));
    const byId = new Map<number, any>(projects.map((p) => [p.id, p]));
    const roots: Node[] = [];
    const getOrAdd = (list: Node[], key: string, label: ReactNode) => {
      let node = list.find((n) => n.key === key);
      if (!node) {
        node = { key, title: label, hours: 0, children: [] };
        list.push(node);
      }
      return node;
    };

    summary.rows.forEach((row) => {
      // Chuỗi project từ gốc tới project Redmine được gán
      const path: { key: string; label: ReactNode }[] = [];
      const project = row.redmineProject ? byName.get(row.redmineProject) : undefined;
      if (project) {
        const seen = new Set<number>();
        let cur = project;
        while (cur && !seen.has(cur.id)) {
          seen.add(cur.id);
          path.unshift({
            key: `p-${cur.id}`,
            label: (
              <Text strong style={{ fontSize: 12 }}>
                <FolderOutlined style={{ color: "#fa8c16", marginRight: 4 }} />
                {cur.name}
              </Text>
            ),
          });
          cur = cur.parent ? byId.get(cur.parent.id) || cur.parent : undefined;
        }
      } else {
        path.push({
          key: `w-${row.redmineProject || row.workspace}`,
          label: (
            <Text style={{ fontSize: 12 }} type="warning">
              <QuestionCircleOutlined style={{ marginRight: 4 }} />
              {row.redmineProject || `Chưa xác định dự án (${row.workspace})`}
            </Text>
          ),
        });
      }

      let level = roots;
      const chain: Node[] = [];
      path.forEach((p) => {
        const node = getOrAdd(level, p.key, p.label);
        chain.push(node);
        level = node.children;
      });
      chain.forEach((n) => (n.hours += row.hours));
      level.push({
        key: `r-${row.key}`,
        hours: row.hours,
        children: [],
        title: (
          <div className="day-summary-row" style={{ opacity: row.added ? 0.55 : 1 }}>
            {row.redmineIssue && (
              <Tag style={{ margin: 0, fontSize: 11 }} color="blue">
                #{row.redmineIssue}
              </Tag>
            )}
            <Tooltip title={row.evidence || row.name}>
              <Text style={{ fontSize: 12, flex: 1, minWidth: 0 }} ellipsis delete={row.added}>
                {row.name}
              </Text>
            </Tooltip>
            <Tag style={{ margin: 0, fontSize: 11 }} color="purple">
              {row.hours.toFixed(1)}h
            </Tag>
            {row.added ? (
              <Tooltip title="Đã tạo task trong kế hoạch">
                <CheckOutlined style={{ color: "var(--success-color)", fontSize: 12 }} />
              </Tooltip>
            ) : (
              <Tooltip title="Tạo task này vào kế hoạch ngày">
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined style={{ fontSize: 11 }} />}
                  style={{ height: 20, width: 20, padding: 0 }}
                  onClick={() => onCreateRows([row])}
                />
              </Tooltip>
            )}
          </div>
        ),
      });
    });

    // Gắn tổng giờ vào tiêu đề nhánh project
    const decorate = (nodes: Node[]): any[] =>
      nodes.map((n) =>
        n.key.startsWith("r-")
          ? { key: n.key, title: n.title, isLeaf: true }
          : {
              key: n.key,
              title: (
                <Space size={4}>
                  {n.title}
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {n.hours.toFixed(1)}h
                  </Text>
                </Space>
              ),
              children: decorate(n.children),
            }
      );
    return decorate(roots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, projects]);

  return (
    <div>
      <div className="section-label" style={{ color: "var(--primary-color, #1677ff)", display: "flex", alignItems: "center", gap: 4 }}>
        <FundViewOutlined />
        <Tooltip title={`Tóm tắt hoạt động: ${totalHours.toFixed(1)}h, ${pendingHours.toFixed(1)}h chờ tạo task`}>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Tóm tắt · {totalHours.toFixed(1)}h{pendingRows.length > 0 && ` · chờ ${pendingHours.toFixed(1)}h`}
          </span>
        </Tooltip>
        <Tooltip title="Xem chi tiết / sửa">
          <Button type="text" size="small" icon={<ExpandOutlined style={{ fontSize: 11 }} />} style={{ height: 20, width: 20, padding: 0 }} onClick={onOpen} />
        </Tooltip>
        <Tooltip title="Xoá tóm tắt">
          <Button type="text" size="small" danger icon={<DeleteOutlined style={{ fontSize: 11 }} />} style={{ height: 20, width: 20, padding: 0 }} onClick={onRemove} />
        </Tooltip>
      </div>
      {summary.overview && (
        <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }} ellipsis={{ tooltip: summary.overview }}>
          {summary.overview}
        </Text>
      )}
      <Tree key={`${summary.createdAt}-${projects.length}`} className="day-summary-tree" showLine blockNode selectable={false} defaultExpandAll treeData={treeData} style={{ fontSize: 12, background: "transparent" }} />
      {pendingRows.length > 0 && (
        <Button size="small" type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 6 }} onClick={() => onCreateRows(pendingRows)}>
          Tạo {pendingRows.length} task ({pendingHours.toFixed(1)}h)
        </Button>
      )}
    </div>
  );
}
