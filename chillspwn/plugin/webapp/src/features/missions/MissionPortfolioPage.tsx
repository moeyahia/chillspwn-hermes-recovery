import { fetchOverview } from "../../data/api/commandOs";
import { useQuery } from "../../data/cache/QueryProvider";
import { ButtonLink, Card, EmptyState, ErrorPanel, LoadingPanel, PageHeader, StatusPill } from "../../design-system/components/Primitives";

export default function MissionPortfolioPage() {
  const overview = useQuery("command-os-overview", fetchOverview);
  return (
    <div className="os-page">
      <PageHeader
        eyebrow="Portfolio"
        title="Missions"
        description="Durable objectives and their current execution attempts. Provider details remain secondary to mission outcomes."
        actions={<ButtonLink href="/missions/new">New mission</ButtonLink>}
      />
      {overview.isLoading && <LoadingPanel label="Loading mission portfolio" />}
      {overview.error && !overview.data && <ErrorPanel error={overview.error} onRetry={overview.refresh} />}
      {overview.data && (
        <Card className="os-table-card">
          {overview.data.missions.length === 0 ? (
            <EmptyState title="No missions yet" description="Choose Autonomous or Guided to create the first durable mission." action={<ButtonLink href="/missions/new">Create mission</ButtonLink>} />
          ) : (
            <div className="os-table-scroll">
              <table>
                <thead><tr><th>Mission</th><th>Journey</th><th>Status</th><th>Phase</th><th>Progress</th><th>Next action</th><th>Updated</th></tr></thead>
                <tbody>{overview.data.missions.map((mission) => (
                  <tr key={mission.id}>
                    <th scope="row"><ButtonLink variant="quiet" href={mission.journey === "guided" ? `/guided/${mission.id}` : `/missions/${mission.id}`}>{mission.title}</ButtonLink></th>
                    <td><StatusPill status={mission.journey} /></td>
                    <td><StatusPill status={mission.status} /></td>
                    <td>{mission.currentPhase ?? "—"}</td>
                    <td>{mission.progress === undefined ? "—" : `${Math.round(mission.progress)}%`}</td>
                    <td>{mission.nextAction ?? "—"}</td>
                    <td><time dateTime={mission.updatedAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(mission.updatedAt))}</time></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
