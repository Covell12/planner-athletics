# Planner athletics data

Meadowbrook's public athletics calendar, as JSON, for the Student Planner.

The planner cannot read the school's calendar feed directly, because the school's
server does not allow other websites to. A GitHub Action runs once a day
(`.github/workflows/refresh.yml`), runs `athletics-sync.mjs`, and commits the
result to `athletics.json`, which the planner then reads from this repo.

Everything here comes from the school's public calendar. To run it by hand, open
the Actions tab, choose **Refresh athletics**, and press **Run workflow**.
