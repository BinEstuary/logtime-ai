# Spent Time Container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the Spent Time screen so it uses the same outer glass-panel card container pattern as the weekly schedule screen.

**Architecture:** Modify the `src/App.tsx` spent-time render block to wrap its title, controls, and content inside an Ant Design `Card` with `className="glass-panel"` and the same outer header layout style as the weekly view.

**Tech Stack:** React, TypeScript, Ant Design, Vite

---

### Task 1: Wrap Spent Time page content in a styled glass-panel Card

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Change the spent-time section header and root wrapper**

Update the `activeModule === "spent_time"` block so the page content is rendered inside a `Card` with `className="glass-panel"` and a matching card title layout.

```tsx
{activeModule === "spent_time" && (
  <Card
    className="glass-panel"
    title={
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <span style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)" }}>
            Lịch sử ghi nhận công việc (Spent Time)
          </span>
          <Text type="secondary" style={{ marginLeft: "12px", fontSize: "14px" }}>
            Xem tất cả thời gian đã báo cáo lên Redmine (người dùng hiện tại)
          </Text>
        </div>
        <Space>
          <Select
            value={spentTimeFilter}
            onChange={(val) => {
              setSpentTimeFilter(val);
              setSpentTimePage(1);
            }}
            style={{ width: 150 }}
            options={[
              { value: "all", label: "Tất cả thời gian" },
              { value: "this_month", label: "Tháng này" },
              { value: "last_month", label: "Tháng trước" },
            ]}
          />
          {(() => {
            const filtered = spentTimeEntries.filter((entry) => {
              if (spentTimeFilter === "this_month") {
                return entry.spent_on && dayjs(entry.spent_on).isSame(dayjs(), "month");
              }
              if (spentTimeFilter === "last_month") {
                return entry.spent_on && dayjs(entry.spent_on).isSame(dayjs().subtract(1, "month"), "month");
              }
              return true;
            });
            const totalHours = filtered.reduce((sum, entry) => sum + (entry.hours || 0), 0);
            return (
              <Tag color="default" style={{ fontSize: "14px", padding: "6px 12px", borderRadius: "6px", background: "var(--card-bg)", borderColor: "var(--glass-border)", color: "var(--text-primary)", fontWeight: 500 }}>
                Tổng cộng: <strong>{totalHours.toFixed(1)} giờ</strong>
              </Tag>
            );
          })()}
          <Button
            type="default"
            icon={<ClockCircleOutlined />}
            onClick={handleFetchSpentTime}
            loading={isLoadingSpentTime}
            style={{ borderRadius: "6px", background: "var(--card-bg)", borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
          >
            Làm mới
          </Button>
        </Space>
      </div>
    }
    style={{ marginBottom: "24px" }}
    bodyStyle={{ padding: "24px" }}
  >
    {/* existing spent-time content moved here unchanged */}
  </Card>
)}
```

- [ ] **Step 2: Move the existing spent-time content inside the new Card**

Ensure the current loading state, filtered date grouping, row layout, and pagination remain inside the `Card` body rather than outside.

- [ ] **Step 3: Confirm the Spent Time block retains its centered page width**

Keep `style={{ maxWidth: "1000px", margin: "0 auto" }}` on the outer wrapper around the new `Card`.

### Task 2: Validate the updated UI locally

**Files:**
- No code changes beyond `src/App.tsx`

- [ ] **Step 1: Run the app locally**

Run: `npm run dev`
Expected: Vite dev server starts successfully, no TypeScript or runtime errors.

- [ ] **Step 2: Verify the Spent Time screen**

Open the app in a browser, navigate to the Spent Time page, and confirm:
- The page is enclosed in a glass-panel style card like the weekly screen.
- The header title and filter controls appear in a card header row.
- The body content renders correctly with the loading spinner, empty state, grouped cards, and pagination.
- There are no console errors.

- [ ] **Step 3: Compare to the weekly layout**

Verify the outer container style and header structure closely match the weekly schedule screen's `Card` pattern.

### Task 3: Save the plan and hand off execution

**Files:**
- Create: `docs/superpowers/plans/2026-05-22-spent-time-container-plan.md`

- [ ] **Step 1: Review this plan for completeness**

Ensure every code change path is specifically documented and the planned UI update is exactly what the user requested.

- [ ] **Step 2: Offer execution choice**

After the plan file is saved: ask whether to execute inline in this session or use subagent-driven development.
