# FintechX Worklog Sync

## What is this?

Chrome extension which creates work logs in FintechX JIRA by time entries in Clockify.

## How to create time entries in Clockify?

- Start with `FTB-`, `FXG-`, `AG8-`, or `FXA-` string and follow it with some numeric character (identification of JIRA ticket, example: `FTB-12537`)
- and follow with any alphanumeric or space character
- and if contain `|` character follow it with a space character (comment of JIRA work log)
- and follow it with any character

Example without comment: `FTB-12537 Other Overhead`
Example with a comment in JIRA work log: `FTB-12537 Other Overhead | Standup`
