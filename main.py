import datetime
import os.path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


# Scopes is for access control.
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]


# Format function for all Google Calendar events
def format_calendar_event(event):

    start = event["start"].get(
        "dateTime",
        event["start"].get("date")
    )

    end = event["end"].get(
        "dateTime",
        event["end"].get("date")
    )

    return {
        "eventId": event.get("id"),
        "summary": event.get(
            "summary",
            "No title"
        ),
        "start": start,
        "end": end,
        "description": event.get(
            "description",
            "No description"
        ),
        "location": event.get(
            "location",
            "No location"
        )
    }


# Get the next 10 upcoming calendar events
def get_calendar_events(service):

    # Call the Calendar API
    now = datetime.datetime.now(
        tz=datetime.timezone.utc
    ).isoformat()

    print("Getting the upcoming 10 events")

    events_result = (
        service.events()
        .list(
            calendarId="primary",
            timeMin=now,
            maxResults=10,
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )

    events = events_result.get("items", [])

    if not events:
        print("No upcoming events found.")
        return []

    calendar_events = []

    for event in events:

        calendar_event = format_calendar_event(
            event
        )

        print(
            calendar_event["start"],
            calendar_event["summary"]
        )

        calendar_events.append(
            calendar_event
        )

    return calendar_events


# Get one specific event using its Google event ID
def get_calendar_event(service, event_id):

    event = (
        service.events()
        .get(
            calendarId="primary",
            eventId=event_id
        )
        .execute()
    )

    return format_calendar_event(event)


# Get all events for a specific date
def get_events_by_date(service, date):

    # Uses the computer's local timezone
    local_timezone = (
        datetime.datetime.now()
        .astimezone()
        .tzinfo
    )

    # Beginning of the selected day
    start_of_day = datetime.datetime.combine(
        date,
        datetime.time.min,
        tzinfo=local_timezone
    )

    # Beginning of the following day
    end_of_day = (
        start_of_day
        + datetime.timedelta(days=1)
    )

    events_result = (
        service.events()
        .list(
            calendarId="primary",
            timeMin=start_of_day.isoformat(),
            timeMax=end_of_day.isoformat(),
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )

    events = events_result.get("items", [])

    calendar_events = []

    for event in events:

        calendar_events.append(
            format_calendar_event(event)
        )

    return calendar_events


def main():

    creds = None

    # The file token.json stores the user's access and refresh tokens, and is
    # created automatically when the authorization flow completes for the first
    # time.
    if os.path.exists("token.json"):

        creds = Credentials.from_authorized_user_file(
            "token.json",
            SCOPES
        )

    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:

        if (
            creds
            and creds.expired
            and creds.refresh_token
        ):

            creds.refresh(Request())

        else:

            flow = (
                InstalledAppFlow
                .from_client_secrets_file(
                    "credentials.json",
                    SCOPES
                )
            )

            creds = flow.run_local_server(
                port=0
            )

        # Save the credentials for the next run
        with open(
            "token.json",
            "w"
        ) as token:

            token.write(
                creds.to_json()
            )

    try:

        service = build(
            "calendar",
            "v3",
            credentials=creds
        )

        calendar_events = (
            get_calendar_events(service)
        )

        return calendar_events

    except HttpError as error:

        print(
            f"An error occurred: {error}"
        )

        return []


if __name__ == "__main__":

    main()
