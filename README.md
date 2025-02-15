## Build .env.local file
```
TEAM_DOMAIN=myteam.org
GOOGLE_ADMIN_ACCOUNT=<email of a Google Workspace admin>
GOOGLE_CUSTOMER=<Workspace tenant id>
GOOGLE_CREDENTIALS=<JSON from Google credentials.json copied into single line>


# ESAR Apps bot in the kingcountyesar workspace
SLACK_BOT_TOKEN=xoxb-...

CALTOPO_ACCOUNT_ID=<6-digit-service-account-id>
CALTOPO_AUTH_ID=
CALTOPO_AUTH_SECRET=

D4H_TEAM=1234
D4H_TOKEN=<v3 API JWT token>
D4H_V2_TOKEN=<v2 API auth token>
```

## Build data/sync-settings.json
```
{
  "users": {
    "d4h": {
      "membersGroup": <1234, id of group that all members belong to>
    },
    "caltopo": {
      "teamId": "6-digit-id-of-team-all-members-belong-to",
      "extraMembers": [
        # Accounts that are not members, but should be on the CalTopo Team
        "base@myteam.org"
      ],
      "emailMap": {
        # If user has email in CalTopo that can't/shouldn't be stored in D4H (ex: old email that's no longer accessible), map it to a good address
        "users-old-account@gmail.com": "user.lastname@myteam.org"
      }
    }
  }
}
```

## Run the server:
```
npx tsx server.ts
```

## Setup crontab to run maintenance tasks:
```
curl http://localhost/tasks/sync-users?to=@My+Slack+User