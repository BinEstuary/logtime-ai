// Daemon ghi nhớ hoạt động máy, chạy ngầm độc lập với app/dev server (xem scripts/install-activity-daemon.sh).
import { activityDataDir, runActivityDaemon } from './activityTracker'

runActivityDaemon(activityDataDir())
