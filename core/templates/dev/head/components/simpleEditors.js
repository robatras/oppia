// Copyright 2012 Google Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS-IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Directives for reusable simple editor components.
 *
 * @author sll@google.com (Sean Lip)
 */

oppia.directive('select2Dropdown', function() {
  // Directive for incorporating select2 dropdowns.
  return {
    restrict: 'E',
    scope: {
      choices: '=',
      item: '=',
      newChoiceRegex: '@',
      placeholder: '@',
      width: '@'
    },
    template: '<input type="hidden">',
    controller: function($scope, $element, $attrs) {
      $scope.newChoiceValidator = new RegExp($scope.newChoiceRegex);

      $scope.makeUnique = function(arr) {
        var hashMap = {};
        var result = [];
        for (var i = 0; i < arr.length; i++) {
          if (!hashMap.hasOwnProperty(arr[i])) {
            result.push(arr[i]);
            hashMap[arr[i]] = 1;
          }
        }
        return result;
      };

      $scope.uniqueChoices = $scope.makeUnique($scope.choices);
      $scope.select2Choices = [];
      for (var i = 0; i < $scope.uniqueChoices.length; i++) {
        $scope.select2Choices.push({
          id: $scope.uniqueChoices[i],
          text: $scope.uniqueChoices[i]
        });
      }

      var select2Node = $element[0].firstChild;
      $(select2Node).select2({
        data: $scope.select2Choices,
        placeholder: $scope.placeholder,
        width: $scope.width || '250px',
        createSearchChoice: function(term, data) {
          if ($(data).filter(function() {
            return this.text.localeCompare(term) === 0;
          }).length === 0) {
            return (
              term.match($scope.newChoiceValidator) ?
                  {id: term, text: term} : null
            );
          }
        }
      });

      // Initialize the dropdown.
      $(select2Node).select2('val', $scope.item);

      // Update $scope.item when the selection changes.
      $(select2Node).on('change', function(e) {
        $scope.item = e.val;
        $scope.$apply();
      });
    }
  };
});

oppia.directive('richTextEditor', function($q, $sce, $modal, $http, warningsData, oppiaHtmlEscaper, requestCreator) {
  return {
    restrict: 'E',
    scope: {htmlContent: '=', disallowOppiaWidgets: '@'},
    template: '<textarea rows="7" cols="60"></textarea>',
    controller: function($scope, $element, $attrs) {
      $scope.disallowOppiaWidgets = ($scope.disallowOppiaWidgets || false);

      var rteNode = $element[0].firstChild;
      // A pointer to the editorDoc in the RTE iframe. Populated when the RTE is
      // initialized.
      $scope.editorDoc = null;

      $scope._createAttrsFromCustomizationArgs = function(customizationArgs) {
        var attrList = [];
        for (var paramName in customizationArgs) {
          for (var argName in customizationArgs[paramName]) {
            attrList.push({
              'name': paramName + '-with-' + argName,
              'value': oppiaHtmlEscaper.objToEscapedJson(
                  customizationArgs[paramName][argName])
            });
          }
        }
        return attrList;
      };

      $scope._createCustomizationArgsFromAttrs = function(attrs) {
        var customizationArgs = {};
        for (var i = 0; i < attrs.length; i++) {
          var attr = attrs[i];
          if (attr.name == 'class' || attr.name == 'src') {
            continue;
          }
          var separatorLocation = attr.name.indexOf('-with-');
          if (separatorLocation === -1) {
            console.log('Error: invalid customization attribute ' + attr.name);
          }
          var paramName = attr.name.substring(0, separatorLocation);
          var argName = attr.name.substring(separatorLocation + 6);
          if (!customizationArgs.hasOwnProperty(paramName)) {
            customizationArgs[paramName] = {};
          }
          customizationArgs[paramName][argName] = (
              oppiaHtmlEscaper.escapedJsonToObj(attr.value));
        }
        return customizationArgs;
      };

      $scope._createRteElement = function(widgetDefinition, customizationArgs) {
        var el = $('<img/>');
        el.attr('src', widgetDefinition.iconDataUrl);
        el.addClass('oppia-noninteractive-' + widgetDefinition.name);

        var attrList = $scope._createAttrsFromCustomizationArgs(customizationArgs);
        for (var i = 0; i < attrList.length; i++) {
          el.attr(attrList[i].name, attrList[i].value);
        }

        var domNode = el.get(0);
        // This dblclick handler is stripped in the initial HTML --> RTE conversion,
        // so it needs to be reinstituted after the jwysiwyg iframe is loaded.
        domNode.ondblclick = function() {
          el.addClass('insertionPoint');
          $scope.getRteCustomizationModal(widgetDefinition, customizationArgs);
        };

        return domNode;
      };

      // Replace <oppia-noninteractive> tags with <img> tags.
      $scope._convertHtmlToRte = function(html) {
        var elt = $('<div>' + html + '</div>');

        $scope._NONINTERACTIVE_WIDGETS.forEach(function(widgetDefn) {
          elt.find('oppia-noninteractive-' + widgetDefn.name).replaceWith(function() {
            return $scope._createRteElement(
                widgetDefn, $scope._createCustomizationArgsFromAttrs(this.attributes));
          });
        });

        return elt.html();
      };

      // Replace <img> tags with <oppia-noninteractive> tags.
      $scope._convertRteToHtml = function(rte) {
        var elt = $('<div>' + rte + '</div>');

        $scope._NONINTERACTIVE_WIDGETS.forEach(function(widgetDefn) {
          elt.find('img.oppia-noninteractive-' + widgetDefn.name).replaceWith(function() {
            var jQueryElt = $('<' + this.className + '/>');
            for (var i = 0; i < this.attributes.length; i++) {
              var attr = this.attributes[i];
              if (attr.name !== 'class' && attr.name !== 'src') {
                jQueryElt.attr(attr.name, attr.value);
              }
            }
            return jQueryElt.get(0);
          });
        });

        return elt.html();
      };

      $scope.getRteCustomizationModal = function(widgetDefinition, customizationArgs) {
        return $http.post(
            '/widgets/noninteractive/' + widgetDefinition.backendName,
            requestCreator.createRequest({
              customization_args: customizationArgs
            }),
            {headers: {'Content-Type': 'application/x-www-form-urlencoded'}}
        ).then(function(response) {
          var modalInstance = $modal.open({
            templateUrl: 'modals/customizeWidget',
            backdrop: 'static',
            resolve: {
              widgetDefinition: function() {
                return widgetDefinition;
              },
              widgetParams: function() {
                return response.data.widget.params;
              }
            },
            controller: function($scope, $modalInstance, widgetDefinition, widgetParams) {
              $scope.widgetParams = widgetParams || {};
              $scope.widgetDefinition = widgetDefinition;

              $scope.save = function(widgetParams) {
                var customizationArgs = {};
                for (var paramName in widgetParams) {
                  customizationArgs[paramName] = widgetParams[paramName].customization_args;
                }
                $modalInstance.close({
                  customizationArgs: customizationArgs,
                  widgetDefinition: $scope.widgetDefinition
                });
              };

              $scope.cancel = function () {
                $modalInstance.dismiss('cancel');
                warningsData.clear();
              };
            }
          });

          modalInstance.result.then(function(result) {
            var el = $scope._createRteElement(result.widgetDefinition, result.customizationArgs);
            var insertionPoint = $scope.editorDoc.querySelector('.insertionPoint');
            insertionPoint.parentNode.replaceChild(el, insertionPoint);
            $(rteNode).wysiwyg('save');
          }, function () {
            var insertionPoint = $scope.editorDoc.querySelector('.insertionPoint');
            insertionPoint.className = insertionPoint.className.replace(
                /\binsertionPoint\b/, '');
            console.log('Modal customizer dismissed.');
          });

          return modalInstance;
        });
      };

      $scope._saveContent = function() {
        var content = $(rteNode).wysiwyg('getContent');
        if (content !== null && content !== undefined) {
          $scope.htmlContent = $scope._convertRteToHtml(content);
          $scope.$apply();
        }
      };

      $scope.$on('externalSave', function() {
        $scope._saveContent();
      });

      $scope.init = function() {
        $http.get('/widgetrepository/data/noninteractive').then(function(response) {
          // TODO(sll): Remove the need for $http.get() if $scope.disallowOppiaWidgets
          // is true.
          if ($scope.disallowOppiaWidgets) {
            $scope._NONINTERACTIVE_WIDGETS = [];
          } else {
            $scope._NONINTERACTIVE_WIDGETS = response.data.widgets['Basic Input'];
          }

          $scope._NONINTERACTIVE_WIDGETS.forEach(function(widgetDefn) {
            widgetDefn.backendName = widgetDefn.name;
            widgetDefn.name = widgetDefn.frontend_name;
            widgetDefn.iconDataUrl = widgetDefn.icon_data_url;
          });
          $scope.rteContent = $scope._convertHtmlToRte($scope.htmlContent);

          $(rteNode).wysiwyg({
            autoGrow: true,
            autoSave: true,
            controls: {
              h1: {visible: false},
              h2: {visible: false},
              h3: {visible: false},
              insertImage: {visible: false},
              justifyCenter: {visible: false},
              justifyFull: {visible: false},
              justifyLeft: {visible: false},
              justifyRight: {visible: false},
              strikeThrough: {visible: false},
              subscript: {visible: false},
              superscript: {visible: false}
            },
            debug: true,
            events: {
              save: function(event) {
                $scope._saveContent();
              }
            },
            initialContent: $scope.rteContent,
            initialMinHeight: '200px',
            resizeOptions: true
          });

          // Add the non-interactive widget controls to the RTE.  
          $scope._NONINTERACTIVE_WIDGETS.forEach(function(widgetDefinition) {
            $(rteNode).wysiwyg('addControl', widgetDefinition.name, {
              groupIndex: 7,
              icon: widgetDefinition.iconDataUrl,
              tooltip: widgetDefinition.tooltip,
              tags: [],
              visible: true,
              exec: function() {
                $(rteNode).wysiwyg(
                    'insertHtml', '<span class="insertionPoint"></span>');
                $scope.getRteCustomizationModal(widgetDefinition, {});
              }
            });
          });

          $scope.editorDoc = $(rteNode).wysiwyg('document')[0].body;

          // Add dblclick handlers to the various nodes.
          $scope._NONINTERACTIVE_WIDGETS.forEach(function(widgetDefinition) {
            var elts = Array.prototype.slice.call(
                $scope.editorDoc.querySelectorAll(
                    '.oppia-noninteractive-' + widgetDefinition.name));
            elts.forEach(function(elt) {
              elt.ondblclick = function() {
                this.className += ' insertionPoint';
                $scope.getRteCustomizationModal(
                    widgetDefinition,
                    $scope._createCustomizationArgsFromAttrs(this.attributes)
                );
              };
            });
          });

          // Disable jquery.ui.dialog so that the link control works correctly.
          $.fn.dialog = null;
        });
      };

      $scope.init();
    }
  };
});


// TODO(sll): Combine all of these into a single directive.

oppia.directive('string', function(warningsData) {
  // Editable string directive.
  return {
    restrict: 'E',
    scope: {item: '=', largeInput: '@'},
    templateUrl: '/templates/string',
    controller: function ($scope, $attrs) {
      $scope.largeInput = ($scope.largeInput || false);

      // Reset the component each time the item changes.
      $scope.$watch('item', function(newValue, oldValue) {
        // Maintain a local copy of 'item'.
        $scope.localItem = {label: $scope.item || ''};
        $scope.active = false;
      });

      $scope.openItemEditor = function() {
        $scope.active = true;
      };

      $scope.closeItemEditor = function() {
        $scope.active = false;
      };

      $scope.replaceItem = function(newItem) {
        if (!newItem) {
          warningsData.addWarning('Please enter a non-empty item.');
          return;
        }
        warningsData.clear();
        $scope.localItem = {label: newItem};
        $scope.item = newItem;
        $scope.closeItemEditor();
      };

      $scope.$on('externalSave', function() {
        if ($scope.active) {
          $scope.replaceItem($scope.localItem.label);
          // The $scope.$apply() call is needed to propagate the replaced item.
          $scope.$apply();
        }
      });
    }
  };
});

oppia.directive('real', function (warningsData) {
  // Editable real number directive.
  return {
    restrict: 'E',
    scope: {item: '='},
    templateUrl: '/templates/real',
    controller: function ($scope, $attrs) {
      // Reset the component each time the item changes.
      $scope.$watch('item', function(newValue, oldValue) {
        // Maintain a local copy of 'item'.
        $scope.localItem = {label: $scope.item || 0.0};
        $scope.active = false;
      });

      $scope.openItemEditor = function() {
        $scope.active = true;
      };

      $scope.closeItemEditor = function() {
        $scope.active = false;
      };

      $scope.replaceItem = function(newItem) {
        if (!newItem || !angular.isNumber(newItem)) {
          warningsData.addWarning('Please enter a number.');
          return;
        }
        warningsData.clear();
        $scope.localItem = {label: (newItem || 0.0)};
        $scope.item = newItem;
        $scope.closeItemEditor();
      };

      $scope.$on('externalSave', function() {
        if ($scope.active) {
          $scope.replaceItem($scope.localItem.label);
          // The $scope.$apply() call is needed to propagate the replaced item.
          $scope.$apply();
        }
      });
    }
  };
});

oppia.directive('int', function (warningsData) {
  // Editable integer directive.
  return {
    restrict: 'E',
    scope: {item: '='},
    templateUrl: '/templates/int',
    controller: function ($scope, $attrs) {
      // Reset the component each time the item changes.
      $scope.$watch('item', function(newValue, oldValue) {
        // Maintain a local copy of 'item'.
        $scope.localItem = {label: $scope.item || 0};
        $scope.active = false;
      });

      $scope.openItemEditor = function() {
        $scope.active = true;
      };

      $scope.closeItemEditor = function() {
        $scope.active = false;
      };

      $scope.isInteger = function(value) {
        return (!isNaN(parseInt(value,10)) &&
                (parseFloat(value,10) == parseInt(value,10)));
      };

      $scope.replaceItem = function(newItem) {
        if (!newItem || !$scope.isInteger(newItem)) {
          warningsData.addWarning('Please enter an integer.');
          return;
        }
        warningsData.clear();
        $scope.localItem = {label: (newItem || 0)};
        $scope.item = newItem;
        $scope.closeItemEditor();
      };

      $scope.$on('externalSave', function() {
        if ($scope.active) {
          $scope.replaceItem($scope.localItem.label);
          // The $scope.$apply() call is needed to propagate the replaced item.
          $scope.$apply();
        }
      });
    }
  };
});

oppia.directive('list', function(warningsData) {
  // Directive that implements an editable list.
  return {
    restrict: 'E',
    scope: {items: '=', largeInput: '@'},
    templateUrl: '/templates/list',
    controller: function($scope, $attrs) {
      $scope.largeInput = ($scope.largeInput || false);

      // Reset the component each time the item list changes.
      $scope.$watch('items', function(newValue, oldValue) {
        // Maintain a local copy of 'items'. This is needed because it is not
        // possible to modify 'item' directly when using "for item in items";
        // we need a 'constant key'. So we represent each item as {label: ...}
        // instead, and manipulate item.label.
        // TODO(sll): Check that $scope.items is a list.
        $scope.localItems = [];
        if ($scope.items) {
          for (var i = 0; i < $scope.items.length; i++) {
            $scope.localItems.push({'label': angular.copy($scope.items[i])});
          }
        }
        $scope.activeItem = null;
      });

      $scope.openItemEditor = function(index) {
        $scope.activeItem = index;
      };

      $scope.closeItemEditor = function() {
        $scope.activeItem = null;
      };

      $scope.addItem = function() {
        $scope.localItems.push({label: ''});
        $scope.activeItem = $scope.localItems.length - 1;
        if ($scope.items) {
          $scope.items.push('');
        } else {
          $scope.items = [''];
        }
      };

      $scope.replaceItem = function(index, newItem) {
        if (!newItem) {
          warningsData.addWarning('Please enter a non-empty item.');
          return;
        }
        $scope.index = '';
        $scope.replacementItem = '';
        if (index < $scope.items.length && index >= 0) {
          $scope.localItems[index] = {label: newItem};
          $scope.items[index] = newItem;
        }
        $scope.closeItemEditor();
      };

      $scope.deleteItem = function(index) {
        $scope.activeItem = null;
        $scope.localItems.splice(index, 1);
        $scope.items.splice(index, 1);
      };

      $scope.$on('externalSave', function() {
        if ($scope.activeItem !== null) {
          $scope.replaceItem(
              $scope.activeItem, $scope.localItems[$scope.activeItem].label);
          // The $scope.$apply() call is needed to propagate the replaced item.
          $scope.$apply();
        }
      });
    }
  };
});

oppia.directive('filepath', function ($http, $rootScope, $sce, warningsData) {
  // Editable filepath directive. This can only be used in the context of an
  // exploration.
  return {
    restrict: 'E',
    scope: {item: '='},
    templateUrl: '/templates/filepath',
    controller: function ($scope, $attrs) {
      $scope.localItem = {label: $scope.item || ''};
      $scope.imageUploaderIsActive = false;

      $scope.explorationId = $rootScope.explorationId;

      if (!$scope.explorationId) {
        console.log('Error: File picker widget called without being given an exploration.');
        // TODO(sll): Send an error to the backend.
        return;
      }

      $scope.$watch('localItem.label', function(newValue, oldValue) {
        if (newValue) {
          warningsData.clear();
          $scope.localItem = {label: newValue};
          $scope.item = newValue;
        }
      });

      $scope.getPreviewUrl = function(filepath) {
        var encodedFilepath = window.encodeURIComponent(filepath);
        return $sce.trustAsResourceUrl(
            '/imagehandler/' + $scope.explorationId + '/' + encodedFilepath);
      };

      $scope.openImageUploader = function() {
        $scope.imageUploaderIsActive = true;
      };

      $scope.closeImageUploader = function() {
        $scope.imageUploaderIsActive = false;
      };

      $scope.uploadNewImage = function(filename) {
        var input = angular.element(document.getElementById('newImage'));

        var file = document.getElementById('newImage').files[0];
        if (!file || !file.size) {
          warningsData.addWarning('Empty file detected.');
          return;
        }
        if (!file.type.match('image.*')) {
          warningsData.addWarning('This file is not recognized as an image.');
          return;
        }

        if (!filename) {
          warningsData.addWarning('Filename must not be empty.');
          return;
        }

        warningsData.clear();

        var form = new FormData();
        form.append('image', file);
        form.append('filename', filename);

        var request = $.ajax({
          url: '/imagehandler/' + $scope.explorationId,
          data: form,
          processData: false,
          contentType: false,
          type: 'POST',
          dataFilter: function(data, type) {
            // Remove the XSSI prefix.
            var transformedData = data.substring(5);
            return JSON.parse(transformedData);
          },
          dataType: 'text'
        }).done(function(data) {
          var inputElement = $('#newImage');
          inputElement.wrap('<form>').closest('form').get(0).reset();
          inputElement.unwrap();
          $scope.filepaths.push(data.filepath);
          $scope.closeImageUploader();
          $scope.localItem.label = data.filepath;
          $scope.$apply();
        }).fail(function(data) {
          console.log(data);
          // Remove the XSSI prefix.
          var transformedData = data.responseText.substring(5);
          var parsedResponse = JSON.parse(transformedData);
          warningsData.addWarning(
              parsedResponse.error || 'Error communicating with server.');
          $scope.$apply();
        });
      };

      $http.get('/create/resource_list/' + $scope.explorationId).success(function(data) {
        $scope.filepaths = data.filepaths;
      });
    }
  };
});
