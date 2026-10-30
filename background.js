"use strict";

chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        try {
            if (request.action && request.action === "startSync") {
                startSync().then(() => {
                    sendResponse({ status: "OK" });
                }).catch((error) => {
                    sendResponse({ status: "NOK", description: JSON.stringify(error) });
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

async function getSynchronizedTagIdsFromClockify(clockifyApiKey, clockifyWorkspaceIds) {
    let synchronizedTagIds = {};
    for (let clockifyWorkspaceId of clockifyWorkspaceIds) {
        let synchronizedTagId = await getOrCreateSynchronizedTagInClockify(clockifyWorkspaceId, clockifyApiKey);
        synchronizedTagIds[clockifyWorkspaceId] = synchronizedTagId;
    }
    return synchronizedTagIds;
}

async function getWorklogsFromClockify(clockifyApiKey, clockifyWorkspaceIds, clockifyUserId) {
    let startDateInRequest = new Date();
    startDateInRequest.setMonth(startDateInRequest.getMonth() - 1);
    startDateInRequest.setHours(0, 0, 0, 0);

    let timeEntries = [];
    for (let clockifyWorkspaceId of clockifyWorkspaceIds) {
        const timeEntriesFromWorkspace = await getTimeEntriesFromClockify(clockifyWorkspaceId, clockifyUserId, startDateInRequest, clockifyApiKey);
        timeEntries = timeEntries.concat(timeEntriesFromWorkspace);
    }
    return timeEntries;
}

async function getTimeEntriesFromClockify(clockifyWorkspaceId, clockifyUserId, startDateInRequest, clockifyApiKey) {
    const timeEntries = [];
    const response = await fetch(`https://api.clockify.me/api/v1/workspaces/${clockifyWorkspaceId}/user/${clockifyUserId}/time-entries?start=${startDateInRequest.toISOString()}&page-size=1000&in-progress=false`, { headers: { "X-Api-Key": `${clockifyApiKey}` } });
    const parsedResponse = await response.json();
    if (!response.ok) {
        throw new Error(`An error has occured: ${response.status} Response: ${JSON.stringify(parsedResponse)}`);
    }
    for (const timeEntry of parsedResponse) {
        let start = new Date(timeEntry.timeInterval.start);
        let end = new Date(timeEntry.timeInterval.end);
        const durationInSeconds = (end.getTime() - start.getTime()) / 1000;
        const durationInMinutes = Math.ceil(durationInSeconds / 60);
        timeEntries.push({
            id: timeEntry.id,
            start: `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}T${start.getHours()}:${start.getMinutes()}:${start.getSeconds()}.${start.getMilliseconds()}+0100`,
            end: `${end.getFullYear()}-${end.getMonth() + 1}-${end.getDate()}T${end.getHours()}:${end.getMinutes()}:${end.getSeconds()}.${end.getMilliseconds()}+0100`,
            durationInSeconds: durationInSeconds,
            durationInMinutes: durationInMinutes,
            description: timeEntry.description,
            billable: timeEntry.billable,
            tagIds: timeEntry.tagIds,
            workspaceId: clockifyWorkspaceId,
            clockifyDetails: timeEntry
        });
    }
    return timeEntries;
}

function filterClockifyTimeEntriesBySynchronizedTag(timeEntries, synchronizedTagIds) {
    return timeEntries.filter((timeEntry) => {
        const synchronizedTagId = synchronizedTagIds[timeEntry.workspaceId];
        const currentTags = timeEntry.tagIds || [];
        return !currentTags.includes(synchronizedTagId);
    })
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

async function getOrCreateSynchronizedTagInClockify(clockifyWorkspaceId, clockifyApiKey) {
    let synchronizedTagId = await getSynchronizedTagInClockify(clockifyWorkspaceId, clockifyApiKey);
    if (!synchronizedTagId) {
        synchronizedTagId = await createSynchronizedTagInClockify(clockifyWorkspaceId, clockifyApiKey);
    }
    return synchronizedTagId;
}

async function getSynchronizedTagInClockify(clockifyWorkspaceId, clockifyApiKey) {
    const getTagResponse = await fetch(`https://api.clockify.me/api/v1/workspaces/${clockifyWorkspaceId}/tags?name=Synchronized&strict-name-search=true`, { headers: { "X-Api-Key": `${clockifyApiKey}` } });
    const parsedGetTagResponse = await getTagResponse.json();
    if (!getTagResponse.ok) {
        throw new Error(`An error has occured: ${getTagResponse.status} Response: ${JSON.stringify(parsedGetTagResponse)}`);
    }
    return parsedGetTagResponse[0]?.id;
}

async function createSynchronizedTagInClockify(clockifyWorkspaceId, clockifyApiKey) {
    const body = {
        name: "Synchronized",
    }
    const createTagResponse = await fetch(`https://api.clockify.me/api/v1/workspaces/${clockifyWorkspaceId}/tags`, { method: 'POST', headers: { 'X-Api-Key': `${clockifyApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const parsedCreateTagResponse = await createTagResponse.json();
    if (!createTagResponse.ok) {
        throw new Error(`An error has occured: ${createTagResponse.status} Response: ${JSON.stringify(parsedCreateTagResponse)}`);
    }
    return parsedCreateTagResponse.id;
}

async function startSync() {
    const clockifyApiKey = await getDetailFromStorage("clockifyApiKey");
    const jiraEmail = await getDetailFromStorage("jiraEmail");
    const jiraToken = await getDetailFromStorage("jiraToken");

    const clockifyWorkspaceIds = await getWorkspacesFromClockify(clockifyApiKey);
    const clockifyUserId = await getUserIdFromClockify(clockifyApiKey);
    const worklogsFromClockify = await getWorklogsFromClockify(clockifyApiKey, clockifyWorkspaceIds, clockifyUserId);
    const synchronizedTagIds = await getSynchronizedTagIdsFromClockify(clockifyApiKey, clockifyWorkspaceIds);
    const filteredWorklogsFromClockify = filterClockifyTimeEntriesBySynchronizedTag(worklogsFromClockify, synchronizedTagIds);

    const worklogsWithError = [];
    for (const worklog of filteredWorklogsFromClockify) {
        const issueKey = worklog.description.split(" ")[0];
        const comment = worklog.description.split("| ")[1];
        const synchronizedTagId = synchronizedTagIds[worklog.workspaceId];
        console.log(`${new Date().toISOString()} | INFO | sync | syncWorklogs | Log work to JIRA: ${JSON.stringify({ issueKey: issueKey, durationInMinutes: worklog.durationInMinutes, comment: comment, started: worklog.start })}`);
        try {
            await addWorklogToJira(issueKey, worklog.durationInMinutes, comment, worklog.start, jiraEmail, jiraToken);
            const synchronizedTagSuccessfullyAdded = await addSynchronizedTagToClockifyWorklog(worklog, synchronizedTagId, clockifyApiKey);
            if (!synchronizedTagSuccessfullyAdded) {
                console.log(`${new Date().toISOString()} | ERROR | ${issueKey} | ${worklog.durationInMinutes}m | from: ${worklog.started} | id: ${worklog.id} | Add Synchronized tag to Clockify time entry was not successful`);
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

async function addSynchronizedTagToClockifyWorklog(worklog, synchronizedTagId, clockifyApiKey) {
    let worklogTagIds = worklog.clockifyDetails.tagIds;
    if (!worklogTagIds) {
        worklogTagIds = [synchronizedTagId];
    } else {
        worklogTagIds.push(synchronizedTagId);
    }
    const body = {
        start: worklog.clockifyDetails.timeInterval.start,
        end: worklog.clockifyDetails.timeInterval.end,
        billable: worklog.clockifyDetails.billable,
        description: worklog.clockifyDetails.description,
        projectId: worklog.clockifyDetails.projectId,
        taskId: worklog.clockifyDetails.taskId,
        customFields: worklog.clockifyDetails.customFields,
        tagIds: worklogTagIds
    }
    const response = await fetch(`https://api.clockify.me/api/v1/workspaces/${worklog.workspaceId}/time-entries/${worklog.id}`, { method: 'PUT', headers: { "X-Api-Key": `${clockifyApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const parsedResponse = await response.json();
    if (!response.ok) {
        throw new Error(`An error has occured: ${response.status} Response: ${JSON.stringify(parsedResponse)}`);
    }
    return true;
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
