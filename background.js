"use strict";

chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        try {
            if (request.action && request.action === "startSync") {
                startSync().then(() => {
                    sendResponse({ status: "OK" });
                });
            } else {
                throw new Error(`Invalid action in request. Action: ${request.action}`);
            }
        } catch (error) {
            sendResponse({ status: "NOK", description: JSON.stringify(error) });
        }
        return true;
    }
);

async function getWorklogsFromClockify(clockifyApiKey) {
    let startDateInRequest = new Date();
    startDateInRequest.setMonth(startDateInRequest.getMonth() - 1);
    startDateInRequest.setHours(0, 0, 0, 0);

    const clockifyWorkspaceIds = await getWorkspacesFromClockify(clockifyApiKey);
    const clockifyUserId = await getUserIdFromClockify(clockifyApiKey);
    let filteredTimeEntries = [];
    for (let clockifyWorkspaceId of clockifyWorkspaceIds) {
        const filteredTimeEntriesFromWorkspace = await getTimeEntriesFromClockify(clockifyWorkspaceId, clockifyUserId, startDateInRequest, clockifyApiKey);
        filteredTimeEntries = filteredTimeEntries.concat(filteredTimeEntriesFromWorkspace);
    }
    return filteredTimeEntries;
}

async function getTimeEntriesFromClockify(clockifyWorkspaceId, clockifyUserId, startDateInRequest, clockifyApiKey) {
    const filteredTimeEntries = [];
    const response = await fetch(`https://api.clockify.me/api/v1/workspaces/${clockifyWorkspaceId}/user/${clockifyUserId}/time-entries?start=${startDateInRequest.toISOString()}&page-size=5000&in-progress=false`, { headers: { "X-Api-Key": `${clockifyApiKey}` } });
    const parsedResponse = await response.json();
    if (!response.ok) {
        throw new Error(`An error has occured: ${response.status} Response: ${JSON.stringify(parsedResponse)}`);
    }
    for (const timeEntry of parsedResponse) {
        if (!timeEntry.billable) {
            let start = new Date(timeEntry.timeInterval.start);
            let end = new Date(timeEntry.timeInterval.end);
            const durationInSeconds = (end.getTime() - start.getTime()) / 1000;
            const durationInMinutes = Math.ceil(durationInSeconds / 60);
            filteredTimeEntries.push({
                id: timeEntry.id,
                start: `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}T${start.getHours()}:${start.getMinutes()}:${start.getSeconds()}.${start.getMilliseconds()}+0100`,
                end: `${end.getFullYear()}-${end.getMonth() + 1}-${end.getDate()}T${end.getHours()}:${end.getMinutes()}:${end.getSeconds()}.${end.getMilliseconds()}+0100`,
                durationInSeconds: durationInSeconds,
                durationInMinutes: durationInMinutes,
                description: timeEntry.description,
                billable: timeEntry.billable,
                workspaceId: clockifyWorkspaceId,
                clockifyDetails: timeEntry
            });
        }
    }
    return filteredTimeEntries;
}

async function getWorkspacesFromClockify(clockifyApiKey) {
    const clockifyWorkspaceIds = [];
    const response = await fetch(`https://api.clockify.me/api/v1/workspaces`, { headers: { "X-Api-Key": `${clockifyApiKey}` } });
    const parsedResponse = await response.json();
    if (!response.ok) {
        throw new Error(`An error has occured: ${response.status} Response: ${JSON.stringify(parsedResponse)}`);
    }
    for (const workspace of parsedResponse) {
        clockifyWorkspaceIds.push(workspace.id);
    }
    return clockifyWorkspaceIds;
}

async function getUserIdFromClockify(clockifyApiKey) {
    const response = await fetch(`https://api.clockify.me/api/v1/user`, { headers: { "X-Api-Key": `${clockifyApiKey}` } });
    const parsedResponse = await response.json();
    if (!response.ok) {
        throw new Error(`An error has occured: ${response.status} Response: ${JSON.stringify(parsedResponse)}`);
    }
    return parsedResponse.id;
}

async function startSync() {
    const clockifyApiKey = await getDetailFromStorage("clockifyApiKey");
    const jiraEmail = await getDetailFromStorage("jiraEmail");
    const jiraToken = await getDetailFromStorage("jiraToken");

    const worklogsFromClockify = await getWorklogsFromClockify(clockifyApiKey);
    const worklogsWithError = [];
    for (const worklog of worklogsFromClockify) {
        const issueKey = worklog.description.split(" ")[0];
        if (!issueKey.startsWith("FTB-") && !issueKey.startsWith("FXG-") && !issueKey.startsWith("AG8-") && !issueKey.startsWith("FXA-") && !issueKey.startsWith("SCR-")) {
            console.log(`${new Date().toISOString()} | ERROR | sync | startSync | Worklog does not contain a valid issue key. IssueKey: ${issueKey})}`);
            worklogsWithError.push(worklog);
            continue;
        }
        const comment = worklog.description.split("| ")[1];
        console.log(`${new Date().toISOString()} | INFO | sync | syncWorklogs | Log work to JIRA: ${JSON.stringify({ issueKey: issueKey, durationInMinutes: worklog.durationInMinutes, comment: comment, started: worklog.start })}`);
        try {
            await addWorklogToJira(issueKey, worklog.durationInMinutes, comment, worklog.start, jiraEmail, jiraToken);
            const billableSuccessfullyEdited = await setBillableFlagToTrueOfClockifyWorklog(worklog, clockifyApiKey);
            if (!billableSuccessfullyEdited) {
                console.log(`${new Date().toISOString()} | ERROR | ${issueKey} | ${worklog.durationInMinutes}m | from: ${worklog.started} | id: ${worklog.id} | Set billable flag to Clockify time entry was not successful`);
                worklogsWithError.push({ issueKey: issueKey, durationInMinutes: worklog.durationInMinutes, comment: comment, started: worklog.start });
            }
        } catch (error) {
            console.log(`${new Date().toISOString()} | ERROR | ${issueKey} | ${worklog.durationInMinutes}m | from: ${worklog.started} | id: ${worklog.id} | Time entry does not updated. | Error: ${error}`);
            worklogsWithError.push({ issueKey: issueKey, durationInMinutes: worklog.durationInMinutes, comment: comment, started: worklog.start });
        }
    }
    if (worklogsWithError.length > 0) {
        throw new Error("Unsuccessful synchronisation. See the logs for more information.");
    }
}

async function addWorklogToJira(issueKey, minutes, comment, started, jiraEmail, jiraToken) {
    const issue = await getIssueFromJira(issueKey, jiraEmail, jiraToken);
    if (issue.fields.assignee.emailAddress !== jiraEmail) {
        throw new Error(`Asignee mismatch: issue assigned to ${issue.fields.assignee.emailAddress}, but your email is ${jiraEmail}`)
    }
    let options = {
        issueIdOrKey: issueKey,
        timeSpent: `${minutes}m`,
        started: started
    };
    if (comment) {
        options.comment = {
            type: "doc",
            version: 1,
            content: [
                {
                    type: "paragraph",
                    content: [
                        {
                            text: comment,
                            type: "text"
                        }
                    ]
                }
            ]
        };
    }
    const response = await fetch(`https://fintechx.atlassian.net/rest/api/3/issue/${issueKey}/worklog`, { method: 'POST', headers: { Authorization: `Basic ${btoa(`${jiraEmail}:${jiraToken}`)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(options) });
    const parsedResponse = await response.json();
    if (!response.ok) {
        throw new Error(`An error has occured: ${response.status} Response: ${JSON.stringify(parsedResponse)}`);
    }
    console.log(`${new Date().toISOString()} | INFO | jira | logWork | IssueKey: ${issueKey} | Time spent: ${minutes}m | From: ${started} | Add worklog was successful`);
    return parsedResponse;
}

async function getIssueFromJira(issueKey, jiraEmail, jiraToken) {
    const response = await fetch(`https://fintechx.atlassian.net/rest/api/3/issue/${issueKey}`, { method: 'GET', headers: { Authorization: `Basic ${btoa(`${jiraEmail}:${jiraToken}`)}` } });
    const parsedResponse = await response.json();
    if (!response.ok) {
        throw new Error(`An error has occured: ${response.status} Response: ${JSON.stringify(parsedResponse)}`);
    }
    return parsedResponse;
}

async function setBillableFlagToTrueOfClockifyWorklog(worklog, clockifyApiKey) {
    const body = {
        start: worklog.clockifyDetails.timeInterval.start,
        end: worklog.clockifyDetails.timeInterval.end,
        billable: true,
        description: worklog.clockifyDetails.description,
        projectId: worklog.clockifyDetails.projectId,
        taskId: worklog.clockifyDetails.taskId,
        customFields: worklog.clockifyDetails.customFields,
        tagIds: worklog.clockifyDetails.tagIds
    }
    const response = await fetch(`https://api.clockify.me/api/v1/workspaces/${worklog.workspaceId}/time-entries/${worklog.id}`, { method: 'PUT', headers: { "X-Api-Key": `${clockifyApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const parsedResponse = await response.json();
    if (!response.ok) {
        throw new Error(`An error has occured: ${response.status} Response: ${JSON.stringify(parsedResponse)}`);
    }
    return parsedResponse.billable;
}

function getDetailFromStorage(detailName) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(detailName, result => {
            if (chrome.runtime.lastError) {
                reject(Error(chrome.runtime.lastError.message));
            } else {
                resolve(result[detailName]);
            }
        });
    });
}
