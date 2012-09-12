var model;
var activeTabAnchor;
var activeTabHref;
var rowid = 1;

var noteLookup = [];
var contextLookup = [];
var idnumLookup = {};
var extracts = {};
var keysFromStorage = {};

var B = Object.freeze({
  ARCHIVE:'.archive-button',
  UNARCHIVE:'.unarchive-button',
  RESUME:'.resume-button',
  DELETE:'.delete-button',
  STORESEP: '_',
  DATESEP: '-',
  SNAPKEY_PREFIX: 'd',
  STATE_PENDING: 'P',
  STATE_ACTIVE: 'A'
});

function tabclick() {
  if (activeTabAnchor) {
    //restore this first, or we can not compare hrefs
    activeTabAnchor.attr('href', activeTabHref);
  }

  //find where the tab link points to
  var tabAnchor = $(this).find('a');
  var tabHref = tabAnchor.attr('href');

  if (tabHref == activeTabHref) {
    //same tab clicked -- remove href again and do nothing further
    activeTabAnchor.removeAttr('href');
    return false;
  }
  if (activeTabAnchor) {
    activeTabAnchor.attr('contentEditable', 'false');
  }
  activeTabAnchor = tabAnchor;
  activeTabHref = tabHref;

  //switch which tab appears active, and remove href so we don't look clicky
  $('ul.tabs li').removeClass('active').removeClass('cactive');
  if (activeTabHref == '#tabsnapshots' || activeTabHref == '#tabnew') {
    //"constant" / non-editable tabs
    $(this).addClass('cactive');
  } else {
    activeTabAnchor.attr('contentEditable', 'true');
    $(this).addClass('active');
  }

  $('.tab_content').hide();
  activeTabAnchor.removeAttr('href');

  $(activeTabHref).show();
  //$(activeTabHref).fadeIn();
  return false;
}

$(document).ready(function() {
  //Default Action
  $('.tab_content').hide(); //Hide all content
  $('ul.tabs li:first').addClass('active').show(); //Activate first tab
  $('.tab_content:first').show(); //Show first tab content
  $('ul.tabs li').click(tabclick);
});

function modelLookup(domObject) {
  var domID = domObject.attr('id');
  var idnum = domID.split('_')[1];
  return modelIndex(idnum);
}

function modelIndex(idnum) {
  var rval = {};
  rval.idnum = idnum;
  rval.note = noteLookup[idnum];
  rval.context = contextLookup[idnum];
  rval.snapshot = document.getElementById('snap_' + idnum);
  rval.td = document.getElementById('cell_' + idnum);
  rval.tr = document.getElementById('row_' + idnum);
  return rval;
}

//template-concept: find "{{text}}" replace with note['text']
function makeDomRow(templateDom, note, context, alternateTextSource) {
  var dom = templateDom.clone();
  var cell = dom.find('td').first();
  var idnum = rowid++;
  var tr_id = 'row_' + idnum;
  var td_id = 'cell_' + idnum;

  dom.attr('id', tr_id);
  cell.attr('id', td_id)
      .html(alternateTextSource ? alternateTextSource.text : note.text);

  //bind the <td> always to the model note object -- not just the text
  noteLookup[idnum] = note;
  contextLookup[idnum] = context;
  if (note.storageKey)
    idnumLookup[note.storageKey] = idnum;

  cell.bind('blur keyup paste', function() {cellChanged($(this));});
  return dom; //still a jQuery object here
}

function moveDomRow(modelPart, templateDom) {
  $('#row_' + modelPart.idnum).detach();
  var tr = makeDomRow(templateDom, modelPart.note, modelPart.context);
  noteLookup[modelPart.idnum] = null;
  contextLookup[modelPart.idnum] = null;
  return tr;
}

function performSnapshot() {
  var now = new Date();
  var key = B.SNAPKEY_PREFIX + now.toISOString().replace(/[-:]/g, '');
  for (var i = 0; i < model.context.length; ++i) {
    var ctx = model.context[i];
    for (var j = 0; j < ctx.notes.length; ++j) {
      var note = ctx.notes[j];
      var state = note.state; //keep, since we might delete it
      if (!state)
        continue;
      if (state === B.STATE_PENDING)
        delete note.state; //else: leave active
      if (!note.snap)
        note.snap = {};

      note.snap[key] = {
        text: note.text,
        state: state
      };
    }
  }
  modelReset(model);
}

function saveModel(filter) {
  if (filter && filter.note.storageKey) {
    var ob = {};
    ob[filter.note.storageKey] = filter.note;
    chrome.storage.sync.set(ob, function() {
        document.getElementById('status').innerHTML
              = 'sync ' + filter.note.storageKey + "@" + new Date();
    });
    return;
  }
  var numContexts = model.context.length;
  var snapshot = {meta: {}};
  var untouchedNotes = $.extend({}, keysFromStorage); //shallow copy
  for (var context_i = 0; context_i < numContexts; context_i++) {
    var prefix = 'c' + context_i;
    var ctx = model.context[context_i];
    snapshot.meta[prefix] = {};
    snapshot.meta[prefix].name = ctx.name;
    var num_notes = ctx.notes.length;
    for (var note_i = 0; note_i < num_notes; note_i++) {
      ctx.notes[note_i].storageKey = prefix + B.STORESEP + note_i;
      var storeKey = ctx.notes[note_i].storageKey;
      snapshot[storeKey] = ctx.notes[note_i];
      delete untouchedNotes[storeKey];
    }
  }
  var toRemove = Object.keys(untouchedNotes);
  if (toRemove.length > 0)
    chrome.storage.sync.remove(Object.keys(untouchedNotes));
  chrome.storage.sync.set(snapshot, function() {
    document.getElementById('status').innerHTML
        = 'full sync at ' + new Date();
  });
}

function cellChanged(cell) {
  var part = modelLookup(cell);
  part.note.text = cell.html();
  if (part.snapshot) {
    part.snapshot.innerHTML = cell.html();
  }
  saveModel(part);
}

function addTriggers(tabDOM) {
  function archiveActive() {
    var part = modelLookup($(this).parent().parent());
    part.note.state = B.STATE_PENDING;
    var tr = moveDomRow(part, tabDOM.trPending);
    $(B.UNARCHIVE, tr).click(unarchivePending);
    tabDOM.find('.pendingcontainer').append(tr);
    saveModel(modelLookup(tr));
  }
  function unarchivePending() {
    var part = modelLookup($(this).parent().parent());
    part.note.state = B.STATE_ACTIVE;
    var tr = moveDomRow(part, tabDOM.trActive); //replace
    $(B.ARCHIVE, tr).click(archiveActive);
    tabDOM.find('.activecontainer').append(tr);
    saveModel(modelLookup(tr));
  }
  function resumeArchived() {
    var part = modelLookup($(this).parent().parent());
    part.note.state = B.STATE_ACTIVE;
    modelReset(model); //
  }
  function addFromTextarea(tabDOM) {
    var note = {
      text: $('.entry', tabDOM).val(),
      state: B.STATE_ACTIVE
    };
    tabDOM.context.notes.push(note);
    var tr = makeDomRow(tabDOM.trActive, note);
    $(B.ARCHIVE, tr).click(archiveActive);
    tabDOM.find('.activecontainer').append(tr);
    $('.entry', tabDOM).val('');
    saveModel(modelLookup(tr));
  }

  $(B.ARCHIVE, tabDOM).click(archiveActive);
  $(B.UNARCHIVE, tabDOM).click(unarchivePending);
  $(B.RESUME, tabDOM).click(resumeArchived);

  $('.addbutton', tabDOM).click(function() {
    addFromTextarea(tabDOM);
  });
  $('.entry', tabDOM).keydown(function (e) {
    if ((e.keyCode == 10 || e.keyCode == 13) && e.ctrlKey) {
      addFromTextarea(tabDOM);
      return false;
    }
  });
}

function appendTab(key, context, clickFunc) {
  if (!clickFunc)
    clickFunc = tabclick;
  //create the tab, from the name
  $('<li>').append(
    $('<a>').attr('href', '#tab' + key).text(
      context.name
    ).bind('blur keyup paste', function() {
      context.name = $(this).text();
      saveModel();
    })
  )
  .attr('id', 'tabtab_' + key)
  .click(clickFunc)
  .addClass('tabtab')
  .appendTo('#tabs');
}

function snapshotTitle(key) {
  return 'Snapshot on ' + key.slice(1,5) + B.DATESEP + key.slice(5,7) + B.DATESEP + key.slice(7,9);
}

function formatExtract(extract) {
  if (extract.state && extract.state === B.STATE_ACTIVE)
    return $('<i>').append(extract.text);
  return extract.text;
}

function appendContext(tabkey, context) {
  appendTab(tabkey, context);

  //create the content, initially hidden, from the templates in the DOM
  var tabDOM = $('#template-divTab').clone()
    .attr('id', 'tab' + tabkey)
    .attr('class', 'tab_content');
  tabDOM.trActive = tabDOM.find('#template-trActive').detach();
  tabDOM.trPending = tabDOM.find('#template-trPending').detach();
  tabDOM.divArchive = tabDOM.find('#template-divArchive').detach();
  tabDOM.trArchive = tabDOM.divArchive.find('#template-trArchive').detach();
  tabDOM.context = context;

  var active = [];
  var pending = [];
  var allSnap = [];
  var mapSnap = {};

  $.each(context.notes, function(key, note) {
    var resumable = false;
    switch (note.state) {
      case 'A':
        active.push(makeDomRow(tabDOM.trActive, note, context));
        break;
      case 'P':
        pending.push(makeDomRow(tabDOM.trPending, note, context));
        break;
      default:
        resumable = true;
    }
    if (!note.snap)
      return; //no snapshots for this note

    $.each(note.snap, function(date, extract) {
      var outerDom = mapSnap[date];
      var anchorName = 'tab' + key + '_' + date;
      if (!outerDom) {
        outerDom = tabDOM.divArchive.clone();
        outerDom.date = date; //we want to sort by this later
        outerDom.find('.snapheader').html(
          $('<a>').attr('id', anchorName)
            .append(snapshotTitle(date))
          );
        mapSnap[date] = outerDom;
        allSnap.push(outerDom);
      }
      var tr = makeDomRow(tabDOM.trArchive, note, context, extract);
      var part = modelLookup(tr);
      if (!resumable) {
        $(B.RESUME, tr).detach();
      }
      outerDom.find('.snapcontainer').append(tr);
      var extlist = extracts[date];
      if (!extlist) {
        extlist = [];
        extracts[date] = extlist;
      }
      var snapshotExtractID = 'snap_' + tr.attr('id').split('_')[1];
      var spandom = $('<span>')
          .attr('id', snapshotExtractID)
          .append(formatExtract(extract));
      extlist.push($('<tr>').append(
        $('<td>').append(
          $('<a>').attr('href', '#' + anchorName)
            .append(context.name)
            .click(function() {
              $('#tabtab_' + tabkey).click();
              var cell = $('#cell_' + part.idnum).focus();
              /* goal: move cursor to end of text (hard) */
              //var selection = window.getSelection();
              //selection.removeAllRanges();
              //range = document.createRange();
              //range.setStart(cell.get(), cell.text().length);
              //range.setEnd(cell.get(), cell.text().length);
              //selection.addRange(range);
              return true; //follow the href to scroll down (maybe)
            })
        ).append(' &middot; ').append(spandom)));
    });
  });

  //Sort snapshots by date
  allSnap.sort(function(lhs, rhs) {
    if (lhs.date == rhs.date)
      return 0;
    return lhs.date < rhs.date ? 1 : -1;
  });

  //more sorting; within nodes?

  $.each(active, function(idx, val) {
    tabDOM.find('.activecontainer').append(val);
  });
  $.each(pending, function(idx, val) {
    tabDOM.find('.pendingcontainer').append(val);
  });
  $.each(allSnap, function(idx, val) {
    tabDOM.append(val);
  });
  addTriggers(tabDOM);
  tabDOM.appendTo('#tabcontainer');
}

function loadSampleModel(why) {
  console.log('loading sample json (' + why + ')...');
  var jqxhr = $.getJSON('sampledata.json', {}, function(data) {
    modelReset(data, 'complete1');
  })
  .error(function(response) {
    console.log(response);
    alert('Problem loading sample model');
  });
}

function modelReset(newmodel, src) {
  model = newmodel;
  activeTabAnchor = null;
  var reactivate = activeTabHref;
  activeTabHref = null;
  if (!reactivate)
    reactivate = 'snapshots';
  else
    reactivate = reactivate.slice(4);

  rowid = 1;
  extracts = {};

  $('.tab_content').detach();
  $('.tabtab').detach();

  appendTab('snapshots', {name: "Snapshots"});
  var snapDOM = $('#template-divSnapshots').clone()
    .attr('id', 'tabsnapshots')
    .attr('class', 'tab_content')
    .appendTo('#tabcontainer');

  $('.settings-button', snapDOM).click(function() {
    chrome.app.window.create('settings.html', {
      'height': 450,
      'width': 450,
      'left': window.screenX + window.outerWidth,
      'top': window.screenY
    }, function(appwindow) {
      appwindow.dom.parent = window;
    });
  });
  $('.snapshot-button', snapDOM).click(function() {
    performSnapshot();
  });

  $.each(model['context'], appendContext);
  var extractDates = [];
  for (key in extracts) {
    extractDates.push(key);
  }
  extractDates.sort(function(lhs, rhs) {
    if (lhs == rhs) return 0;
    return lhs < rhs ? 1 : -1; //reverse
  });

  $.each(extractDates, function(idx, date) {
    var rows = extracts[date];
    var tableDOM = $('<table>');
    $.each(rows, function(idx, tr) {
      tableDOM.append(tr);
    });
    $('<dl>')
      .append($('<dt>').append(snapshotTitle(date)))
      .append($('<dd>').append(tableDOM))
      .appendTo('#tabsnapshots');
  });
  appendTab('new', {name: "New"}, function() {
    model.context.push({name:'',  notes:[]});
    modelReset(model);
    $('#tabtab_' + (model.context.length-1)).click().focus();
    return false;
  });
  $('#tabtab_' + reactivate).click();
  saveModel();
}

function loadFromStorage(syncmodel) {
  var jsonmodel = {context: []};
  $.each(syncmodel.meta, function(prefix, context) {
    var idx = prefix.slice(1);
    jsonmodel.context[idx] = {
      name : context.name,
      notes: []
    };
  });
  keysFromStorage = {};
  $.each(syncmodel, function(noteid, note) {
    if (noteid == 'meta')
      return;
    var keys = noteid.split(B.STORESEP);
    if (noteid[0] != 'c' || keys.length != 2) {
      console.log("Deleting unknown/malformed key -- " + noteid);
      chrome.storage.sync.remove(noteid);
      return;
    }
    keysFromStorage[noteid] = 1;
    var context = jsonmodel.context[keys[0].slice(1)];
    if (!context) {
      console.log("No context for key -- " + noteid);
      return;
    }
    context.notes[keys[1]] = note;
  });
  modelReset(jsonmodel, 'storage.sync');
}

function changeTrigger(changes, namespace) {
  if (changes.length == 1) {
    for (key in changes) {
      var change = changes[key];
      if (change.newValue.text) {
        var idnum = idnumLookup[key];
        if (idnum) {
          var part = modelIndex(idnum);
          if (part.note.text == change.oldValue.text) {
            part.note.text = change.newValue.text;
            part.note.state = change.newValue.state;
            part.note.snap = change.newValue.snap;
            modelReset(model);
          }
        }
      }
    }
  }
  for (key in changes) {
    var storageChange = changes[key];
    if (false) console.log('Storage key "%s" in namespace "%s" changed. ' +
                'Old value was "%s", new value is "%s".',
                key,
                namespace,
                storageChange.oldValue,
                storageChange.newValue);
  }
}

onload = function() {
  chrome.storage.sync.get(null, function(syncmodel) {
    if (!syncmodel.meta) {
      console.log(syncmodel);
      loadSampleModel('"meta" not in model:');
    } else {
      loadFromStorage(syncmodel);
    }
  });
  chrome.storage.onChanged.addListener(changeTrigger);

  var minimizeNode = document.getElementById('minimize-button');
  if (minimizeNode) {
    minimizeNode.onclick = function() {
      chrome.runtime.getBackgroundPage(function(background) {
        background.minimizeAll();
      });
    };
  }
}
