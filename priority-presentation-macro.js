/********************************************************
*
* Macro Author:      	William Mills
*                    	Technical Solutions Specialist
*                    	wimills@cisco.com
*                    	Cisco Systems
*
* Version: 1-0-0
* Released: 01/23/25
*
* This is an example macro which ensures only one presentation
* is displayed on a Cisco RoomOS Device using on a configurable
* source priority order and video signal
*
* Full Readme, source code and license agreement available on Github:
* https://github.com/wxsd-sales/priority-presentation-macro
*
********************************************************/

import xapi from 'xapi';

/*********************************************************
 * Configure the settings below
 **********************************************************/

const config = {
  presentationSourceOrder: [2, 3],  // List of required presentation sources in order or priority
  noSignalAutoHalfwake: true,       // Automatically put the device in half wake when no presentation source signal is detected
  alert: {
    showAlert: true,                // Show alert when switching from one old source to another
    alertDetails: {                 // Alert Details: https://roomos.cisco.com/xapi/Command.UserInterface.Message.Alert.Display/
      Duration: 30,
      Title: 'Auto Share Macro',
      Text: 'Unplug cable to restore previous presentation'
    }
  }
}


/*********************************************************
 * Main functions and event subscriptions
 **********************************************************/

// Create debounce for processing presentation state
const processPresentationStateDebounce = debounce(processPresentationState, 2000)

xapi.Status.SystemUnit.Uptime.get()
  .then(uptime => {
    const parsedUptime = parseInt(uptime)
    if (parsedUptime > 60) return init()
    setTimeout(init, (60 - parsedUptime) * 1000)
  })

function init() {

  // Upon macro start check presentation status
  xapi.Status.Conference.Presentation.LocalInstance.get().then(checkPresentation)

  // Subscribe to Presentation and Video Input Connector changes
  xapi.Status.Conference.Presentation.LocalInstance.on(checkPresentation);
  xapi.Status.Video.Input.Connector.SignalState.on(checkSignal)
}



// Process Presentation Changes
async function checkPresentation(status) {
  console.debug('Presentation change', status)
  processPresentationStateDebounce()
}

// Process Signal Changes
async function checkSignal(status) {
  if (!status) return
  console.debug('Connector SignalState Change:', status)
  if (status == 'DetectingFormat') return
  processPresentationStateDebounce()
}


async function processPresentationState() {

  const presentationSources = await getPresentationSources();
  const sourceSignals = await getSignalSources();

  const presentationSourceOrder = config.presentationSourceOrder;

  console.log('Processing Presentation State')
  console.log('Presentation Sources', JSON.stringify(presentationSources))
  console.log('Source Signals:', JSON.stringify(sourceSignals))
  console.log('Presentation Source Order:', JSON.stringify(presentationSourceOrder))

  const validSourceSignals = presentationSourceOrder.some(source => sourceSignals.includes(source))

  if (!validSourceSignals && config.noSignalHalfwake) {
    console.log('No required sources present, entering halfwake')
    xapi.Command.Standby.Halfwake();
    return
  }


  let requiredSource;

  for (let i = 0; i < presentationSourceOrder.length; i++) {
    const source = presentationSourceOrder[i];
    if (!requiredSource && sourceSignals.includes(source)) {
      console.log('Tagging source', source, 'as required');
      requiredSource = source;
    }
  }


  let endPresentations;

  if (!requiredSource) {
    console.log('No required source found');
    endPresentations = presentationSources;
    return
  }

  // Identify redundant presentations
  endPresentations = presentationSources.filter(source => source != requiredSource)

  // Stop any redundant presentations
  for (let i = 0; i < endPresentations.length; i++) {
    const endSource = endPresentations[i];
    console.log('Stopping Presentation Source:', endSource)
    await xapi.Command.Presentation.Stop({ PresentationSource: endSource });
    await sleep(200)
  }

  if (endPresentations.length > 0) {
    alert();
  }

  if (presentationSources.includes(requiredSource)) {
    console.log('Source:', requiredSource, 'already presenting')
    return
  }
  await sleep(200)

  console.log('Starting Presentation Source:', requiredSource)
  xapi.Command.Presentation.Start({ PresentationSource: requiredSource });

}


function identifySourceSignals(connectors) {
  connectors = connectors.filter(connector => connector.SignalState == 'OK')
  connectors = connectors.map(connector => parseInt(connector.id))
  return connectors
}

async function sleep(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay))
}

function getPresentationSources() {
  return xapi.Status.Conference.Presentation.LocalInstance.get()
    .then(result => result.map(instance => parseInt(instance.Source)))
}

async function getSignalSources() {
  return xapi.Status.Video.Input.Connector.get().then(identifySourceSignals);
}

function debounce(callback, wait) {
  let timeoutId = null;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      callback(...args);
    }, wait);
  };
}

function alert() {
  if (!config.alert.showAlert) return
  xapi.Command.UserInterface.Message.Alert.Display(config.alert.alertDetails);
}
