define([ 'jquery', 'underscore', 'backbone', 'textus', 'views/textView', 'views/textFooterView' ], function($, _,
		Backbone, textus, TextView, TextFooterView) {

	return function(models) {

		/**
		 * Called when populating the model, retrieves a single extent of text along with its
		 * typographical and semantic annotations.
		 */
		var retrieveText = function(offset, length, callback) {
			console.log("Retrieving " + length + " characters of text from " + offset);
			$.getJSON("api/text/textid/" + offset + "/" + (offset + length), function(data) {
				callback(data);
			});
		};

		/**
		 * The maximum number of character to retrieve in a single request from the text service
		 * when populating the text container. This must be a power of two - we don't check for this
		 * later on and setting it to anything else will cause confusion.
		 */
		var textChunkSize = 2048;

		/**
		 * Updates models.textModel with the newly retrieved text and annotations.
		 * 
		 * @param offset
		 *            The character offset to start pulling text
		 * @param forwards
		 *            If true treat the offset value as the first character in the resultant text,
		 *            otherwise treat it as the character beyond the final character in the
		 *            resultant text.
		 * @param height
		 *            Target height to fill to, relative to the value returned by the measure
		 *            function.
		 * @param measure
		 *            A function used to determine the height of a block of retrieved text and
		 *            annotations. Accepts HTML as its single argument and returns the pixel height
		 *            of the result.
		 */
		var updateTextAsync = function(offset, forwards, height, measure) {

			var textBoundaryReached = false;

			var markupStruct = function(struct) {
				return textus.markupText(struct.text, struct.offset, struct.typography, struct.semantics);
			};

			/* Struct is {offset:int, text:string, typography:[], semantics:[]}} */
			var fetch = function(struct) {
				if (measure(markupStruct(struct)) > height || textBoundaryReached) {
					trim(struct);
				} else {
					if (forwards) {
						retrieveText(struct.offset + struct.text.length, textChunkSize, function(data) {
							if (data.text.length < textChunkSize) {
								textBoundaryReached = true;
							}
							if (struct.text == "") {
								struct.typography = data.typography;
								struct.semantics = data.semantics;
							} else {
								data.typography.forEach(function(annotation) {
									if (annotation.start > offset + struct.text.length) {
										struct.typography.push(annotation);
									}
								});
								data.semantics.forEach(function(annotation) {
									if (annotation.start > offset + struct.text.length) {
										struct.semantics.push(annotation);
									}
								});
							}
							struct.text = struct.text + data.text;
							fetch(struct);
						});
					} else {
						var newOffset = Math.max(0, struct.offset - textChunkSize);
						if (newOffset == 0) {
							textBoundaryReached = true;
						}
						var sizeToFetch = struct.offset - newOffset;
						retrieveText(newOffset, sizeToFetch, function(data) {
							if (struct.text == "") {
								struct.typography = data.typography;
								struct.semantics = data.semantics;
							} else {
								data.typography.forEach(function(annotation) {
									if (annotation.end < struct.offset) {
										struct.typography.push(annotation);
									}
								});
								data.semantics.forEach(function(annotation) {
									if (annotation.end < struct.offset) {
										struct.semantics.push(annotation);
									}
								});
							}
							struct.offset = newOffset;
							struct.text = data.text + struct.text;
							fetch(struct);
						});
					}
				}
			};

			/**
			 * Trim the content of the input struct until the text exactly fits in the target
			 * container height. Do this by testing for a fit, and changing the start or end offset
			 * (depending on whether we're going forwards or backwards) by an amount which is
			 * progressively reduced each iteration.
			 */
			var trim = function(data) {
				console.log("Starting trim function, text has offset " + data.offset + " and length "
						+ data.text.length);
				var trimData = function(length) {
					var amountRemoved = data.text.length - length;
					return {
						text : forwards ? (data.text.substring(0, length)) : (data.text.substring(amountRemoved,
								data.text.length)),
						offset : forwards ? (data.offset) : (data.offset + amountRemoved),
						typography : data.typography,
						semantics : []
					};
				};

				var textLength = data.text.length - (textChunkSize - 1);
				console.log("Text length starts at " + textLength);
				var i = textChunkSize;
				while (i > 1) {
					i = i / 2;
					var test = trimData(textLength + i);
					console.log("Trim - end offset of text is " + (test.offset + test.text.length));
					console.log("Trimmed text : " + test.text.substring(0, 20) + "...");
					var measured = measure(markupStruct(test));
					if (measured <= height) {
						textLength = textLength + i;
						console.log("Text length is " + textLength + " (+" + i + ")");
					} else {
						console.log("Text is too high - measured at " + measured + ", maximum is " + height);
					}
				}
				var t = trimData(textLength);
				var annotationFilter = function(a) {
					return a.end >= t.offset && a.start <= (t.offset + t.text.length);
				};
				console.log("Offset = " + t.offset + " text.length = " + t.text.length);
				/*
				 * Handle the special case where we went back and the start offset ended up being
				 * zero. In these cases we should re-do the entire call going fowards from zero
				 */
				if (!forwards && t.offset == 0) {
					updateTextAsync(0, true, height, measure);
				} else {
					if (forwards && t.text.length == 0) {
						updateTextAsync(t.offset, false, height, measure);
					} else {
						models.textModel.set({
							text : t.text,
							offset : t.offset,
							typography : data.typography.filter(annotationFilter),
							semantics : data.semantics.filter(annotationFilter)
						});
					}
				}
			};

			fetch({
				text : "",
				offset : offset,
				typography : [],
				semantics : [],
				cachedHTML : null
			});

		};

		this.name = "ReadTextActivity";

		this.start = function(location) {

			var currentOffset = location.offset;

			// Create a new textView
			var textView = new TextView({
				textModel : models.textModel,
				presenter : {
					/**
					 * Called by the view when a selection of text has been made, used to set the
					 * text selection model.
					 * 
					 * @param start
					 *            The absolute index of the first character in the selected text.
					 * @param end
					 *            The absolute index of the last character in the selected text,
					 *            should be start + text.length assuming all's working.
					 * @param text
					 *            The text of the selection.
					 */
					handleTextSelection : function(start, end, text) {
						models.textSelectionModel.set({
							start : start,
							end : end,
							text : text
						});
					},

					/**
					 * Called by the view when it's been resized and needs to have its text
					 * re-filled.
					 */
					requestTextFill : function() {
						updateTextAsync(models.textModel.get("offset"), true, textView.pageHeight(), textView.measure);
					}
				},
				textLocationModel : models.textLocationModel,
				el : $('.main')
			});

			var textFooterView = new TextFooterView(
					{
						presenter : {
							back : function() {
								updateTextAsync(models.textModel.get("offset"), false, textView.pageHeight(),
										textView.measure);
								console.log("Back button pressed.");
							},
							forward : function() {
								updateTextAsync(models.textModel.get("offset") + models.textModel.get("text").length,
										true, textView.pageHeight(), textView.measure);
								console.log("Forward button pressed.");
							}
						},
						el : $('.footer')
					});

			/*
			 * Set up a listener on selection events on the text selection model
			 */
			var s = models.textSelectionModel;
			s.bind("change", function(event) {
				if (s.get("text") != "") {
					alert("Text selected '" + s.get("text") + "' character range [" + s.get("start") + ","
							+ s.get("end") + "]");
				}
			});

			/*
			 * Listen to changes on the offset property and re-write the URL appropriately
			 */
			var t = models.textModel;
			t.bind("change offset", function() {
				location.router.navigate("text/textId/" + t.get("offset"));
			});

			/*
			 * Get text and update the view based on the location passed into the activity via the
			 * URL
			 */
			updateTextAsync(currentOffset, true, textView.pageHeight(), textView.measure);

		};

		this.stop = function(callback) {
			// Unbind the change listener on the text selection model
			models.textSelectionModel.unbind("change");
			callback(true);
		};
	};
});