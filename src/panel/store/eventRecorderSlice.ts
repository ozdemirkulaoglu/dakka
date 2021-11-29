import { v4 as uuid } from 'uuid'
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { WritableDraft } from 'immer/dist/internal'

import eventsList from 'constants/eventsList'

export type EventListItem = IEventPayload | IEventPayload[] | IEventBlock

export interface EventRecorderState {
  isRecorderEnabled: boolean
  activeTabID: number
  events: Record<number, EventListItem[]>
  eventsToTrack: Record<string, boolean>
  firstEventStartedAt: number
  currentEventIndex: number
  isManualEventInsert: boolean
}

export interface ISelector {
  name: string
  value: string
  ariaLabel?: string
}

export interface ISelectorPayload {
  selectedSelector: ISelector
  record: IEventPayload
}

export interface IEventBlock {
  type: string
  id: string
  eventRecordIndex: number
  deltaTime: number
  triggeredAt: number
  variant: string
}

export interface IEventBlockPayload {
  type: string
  triggeredAt: number
  eventIndex: number
  deltaTime: number
}

export interface IEventPayload {
  id: string
  selector: string
  type: string
  triggeredAt: number
  eventRecordIndex: number
  deltaTime: number
  validSelectors?: ISelector[]
  selectedSelector?: ISelector
  url?: string
  variant: string
}

export interface IEventRecord {
  id: string
  type: string
  payload: IEventPayload
}

export interface IRecordEventPayload {
  tabId: number
  eventRecord: IEventRecord
}

const defaultEventsToTrack = Object.fromEntries(
  eventsList
    .map((group) => group.events)
    .flat()
    .map(({ key, defaultSelected }) => [key, defaultSelected ?? false]),
)

const initialState: EventRecorderState = {
  isRecorderEnabled: false,
  activeTabID: -1,
  events: {},
  eventsToTrack: defaultEventsToTrack,
  firstEventStartedAt: 0,
  currentEventIndex: 0,
  isManualEventInsert: false,
}

function checkIsDuplicatedEvent(
  events: EventListItem[],
  eventRecord: IEventRecord,
) {
  const currentIndex = (events.length ?? 1) - 1

  const prevEvents = events?.[currentIndex] as IEventPayload[]

  const { triggeredAt, selector, type } = ((Array.isArray(
    events?.[currentIndex],
  )
    ? prevEvents[prevEvents.length - 1]
    : events?.[currentIndex]) ?? {}) as IEventPayload

  const isDuplicatedEvent =
    currentIndex >= 1 &&
    triggeredAt === eventRecord.payload.triggeredAt &&
    selector === eventRecord.payload.selector &&
    type === eventRecord.payload.type

  return isDuplicatedEvent
}

function calculateDeltaTime(
  prevEvent: EventListItem,
  currentEvent: IEventPayload,
) {
  const delta =
    currentEvent.triggeredAt -
    ((prevEvent as IEventPayload[])?.[0]?.triggeredAt ??
      (prevEvent as IEventPayload)?.triggeredAt)
  return Number.isFinite(delta) ? delta : 0
}

function composeEvents(
  events: EventListItem[],
  event: IEventPayload,
  index: number,
) {
  if (index === 0) {
    events.push({ ...event, deltaTime: 0 })
  }

  if (index > 0) {
    const previous = events[events.length - 1]
    if (Array.isArray(previous)) {
      const previousEvents = previous as IEventPayload[]
      const l = previousEvents.length
      event.deltaTime = calculateDeltaTime(previousEvents[0], event)
      if (event.triggeredAt === previousEvents[l - 1].triggeredAt) {
        ;(events[events.length - 1] as IEventPayload[]).push(event)
      } else {
        events.push(event)
      }
    } else {
      const previousEvent = previous as IEventPayload
      event.deltaTime = calculateDeltaTime(previousEvent, event)
      if (event?.triggeredAt === previousEvent?.triggeredAt) {
        events[events.length - 1] = [previousEvent, event]
      } else {
        events.push(event)
      }
    }
  }
}

export const eventRecorderSlice = createSlice({
  name: 'eventRecorder',
  initialState,
  reducers: {
    setActiveTabID: (state, action: PayloadAction<number>) => {
      state.activeTabID = action.payload
    },
    toggleIsRecorderEnabled: (state) => {
      state.isRecorderEnabled = !state.isRecorderEnabled
    },
    recordEvent: (
      state,
      { payload: { tabId, eventRecord } }: PayloadAction<IRecordEventPayload>,
    ) => {
      const { events, eventsToTrack, isRecorderEnabled } = state

      if (!isRecorderEnabled) {
        return state
      }

      const hasInValidTabIdOrEventShouldNotBeRecorded =
        tabId < 0 || !eventsToTrack[eventRecord.payload.type]

      if (hasInValidTabIdOrEventShouldNotBeRecorded) {
        return state
      }

      const isFirstEventRecordedForTab = !events[tabId] || !events[tabId].length

      if (isFirstEventRecordedForTab) {
        state.firstEventStartedAt = eventRecord.payload.triggeredAt
        events[tabId] = []
      }
      eventRecord.payload.triggeredAt -= state.firstEventStartedAt

      if (!Number.isFinite(eventRecord.payload.triggeredAt)) {
        eventRecord.payload.triggeredAt = 0
      }

      if (checkIsDuplicatedEvent(events[tabId], eventRecord)) {
        return state
      }

      eventRecord.payload.eventRecordIndex = state.currentEventIndex
      composeEvents(events[tabId], eventRecord.payload, state.currentEventIndex)
      state.currentEventIndex++
      state.isManualEventInsert = false
    },
    clearEvents: (state, { payload: { tabId } }) => {
      state.events[tabId] = []
      state.firstEventStartedAt = 0
      state.currentEventIndex = 0
    },
    selectEventSelector: (
      { events },
      { payload: { record, selectedSelector, tabId } },
    ) => {
      const updateSelector = (eventRecord: WritableDraft<IEventPayload>) => {
        if (eventRecord.selector === record.selector) {
          eventRecord.selectedSelector = selectedSelector
        }
      }

      events[tabId]
        .flat()
        .forEach((e) => updateSelector(e as WritableDraft<IEventPayload>))
    },
    toggleEventToTrack: (
      { eventsToTrack },
      { payload }: PayloadAction<string>,
    ) => {
      eventsToTrack[payload] = !eventsToTrack[payload]
    },
    toggleEventsToTrack: (
      { eventsToTrack },
      { payload }: PayloadAction<boolean>,
    ) => {
      Object.keys(eventsToTrack).forEach(
        (key) => (eventsToTrack[key] = payload),
      )
    },
    removeEvent: (
      state,
      { payload: { eventIds } }: PayloadAction<{ eventIds: number[] }>,
    ) => {
      const tabId = state.activeTabID
      const [first, second] = eventIds
      if (Array.isArray(state.events[tabId][first])) {
        const it = state.events[tabId][first] as unknown as WritableDraft<
          IEventPayload[]
        >
        it.splice(second, 1)
        if (it.length === 1) {
          state.events[tabId][first] = it[0]
        }
        if (it.length === 0) {
          state.events[tabId].splice(first, 1)
        }
      } else {
        state.events[tabId].splice(first, 1)
      }

      state.currentEventIndex -= 1
      state.firstEventStartedAt =
        (state.events[tabId][0] as WritableDraft<IEventPayload[]>)?.[0]
          ?.triggeredAt ??
        (state.events[tabId][0] as WritableDraft<IEventPayload>)?.triggeredAt

      if (state.events[tabId].length > 1) {
        state.events[tabId].flat().forEach((it, index, arr) => {
          if (index === 0) {
            ;(it as WritableDraft<IEventPayload>).deltaTime = 0
            return
          }
          ;(it as WritableDraft<IEventPayload>).deltaTime = calculateDeltaTime(
            arr[index - 1],
            it as WritableDraft<IEventPayload>,
          )
        })
      }
    },
    insertBlock: (
      state,
      { payload: { type, eventIndex, deltaTime, triggeredAt } },
    ) => {
      const tabId = state.activeTabID
      const index = eventIndex + 1
      const block = {
        id: uuid(),
        eventRecordIndex: index,
        type,
        variant: 'InteractiveElement',
        triggeredAt,
        deltaTime,
      } as WritableDraft<IEventBlock>

      state.events[tabId].splice(index, 0, block)

      state.events[tabId].flat().reduce((prev, it, index) => {
        if (index === 0) {
          it.triggeredAt = 0
          return it.triggeredAt
        }

        if (it.triggeredAt === prev) {
          it.triggeredAt += 1
          return it.triggeredAt
        }

        return it.triggeredAt
      }, 0)

      state.isManualEventInsert = true
      state.currentEventIndex += 1
    },
  },
})

export const {
  toggleEventsToTrack,
  selectEventSelector,
  setActiveTabID,
  toggleIsRecorderEnabled,
  recordEvent,
  clearEvents,
  toggleEventToTrack,
  removeEvent,
  insertBlock,
} = eventRecorderSlice.actions

export default eventRecorderSlice.reducer
