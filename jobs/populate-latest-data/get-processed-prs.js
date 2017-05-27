'use strict'

const _ = require('lodash')
const compact = require('lodash/fp/compact')
const flow = require('lodash/fp/flow')
const sortBy = require('lodash/fp/sortBy')
const first = require('lodash/fp/first')

const { getGhJson } = require('./xhr')

function getProcessedPrs() {
  return getPrNumbers().then(getActualPrsWithEvents).then(createFinalPrObjs)
}

function getPrNumbers() {
  return getGhJson({
    path: 'pulls',
    query: {
      per_page: '80',
      state: 'all',
    },
  }).then(prs => prs.map(pr => pr.number))
}

function getActualPrsWithEvents(prNumbers) {
  return Promise.all(
    prNumbers.map(number =>
      Promise.all([
        getGhJson({
          path: `pulls/${number}`,
        }),
        getGhJson({
          path: `issues/${number}/timeline`,
          query: { per_page: '100' },
        }),
      ]).then(([pr, events]) => ({ pr, events }))
    )
  )
}

const filterEventsByLabel = (events, label) =>
  events.filter(e => _.get(e, 'label.name') === label)
const getLastGtgEvent = events =>
  _.last(filterEventsByLabel(events, 'good to go'))

const getDateCreated = event => (event ? new Date(event.created_at) : null)

function createFinalPrObjs(prsAndEvents) {
  return prsAndEvents.map(thing => {
    const { pr, events = [] } = thing
    const gtgEvent = getLastGtgEvent(events)
    const dateGtG = getDateCreated(gtgEvent)
    const dateMerged = pr.merged_at ? new Date(pr.merged_at) : null
    const commentEvents = events.filter(e => e.event === 'commented')
    const commenters = _.uniq(commentEvents.map(e => e.actor.login))
    const needsReviewEvents = filterEventsByLabel(events, 'needs review')
    const needsRevisionEvents = filterEventsByLabel(
      events,
      'needs revision/discussion'
    )
    const firstNeedsReviewEvent = _.first(needsReviewEvents)
    const dateFirstNeedsReview = getDateCreated(firstNeedsReviewEvent)

    const firstReviewLabelChangeEvent = flow(
      compact,
      sortBy('created_at'),
      first
    )([gtgEvent].concat(needsRevisionEvents))
    const dateFirstReviewLabelChanged = getDateCreated(
      firstReviewLabelChangeEvent
    )

    let waitingForReview = null
    let spentInReview = null
    let afterReviewBeforeMerge = null

    if (dateFirstReviewLabelChanged && dateFirstNeedsReview) {
      waitingForReview = dateFirstReviewLabelChanged - dateFirstNeedsReview
    }

    if (dateFirstReviewLabelChanged && dateGtG) {
      spentInReview = dateGtG - dateFirstReviewLabelChanged
    }

    if (dateMerged && dateGtG) {
      afterReviewBeforeMerge = dateMerged - dateGtG
    }

    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      body: pr.body,
      author: pr.user.login,
      additions: pr.additions,
      deletions: pr.deletions,
      dateCreated: pr.created_at,
      dateClosed: pr.closed_at,
      dateMerged: pr.merged_at,
      gtgReviewer: gtgEvent && gtgEvent.actor.login,
      commenters,
      numRevisions: needsRevisionEvents.length,
      times: {
        waitingForReview,
        spentInReview,
        afterReviewBeforeMerge,
      },
    }
  })
}

module.exports = getProcessedPrs