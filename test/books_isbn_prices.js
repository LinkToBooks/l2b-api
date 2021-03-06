"use strict";

require("./setup");

var assert  = require("assert"),
    async   = require("async"),
    _       = require("underscore"),
    request = require("supertest"),
    fetcher = require("openbookprices-fetchers"),
    apiApp  = require("../"),
    samples = require("./samples"),
    helpers = require("../src/helpers"),
    config  = require("config");

var testBaseUrl = config.api.protocol + "://" + config.api.hostport;
var booksBaseURL = samples("booksBaseURL");
request = request(apiApp());

describe("/v1/books/:isbn/prices", function () {

  describe("/", function () {

    it("should redirect to normalised isbn13", function (done) {
      request
        .get("/v1/books/0340831499/prices")
        .expect(301)
        .expect("Location", testBaseUrl + "/v1/books/9780340831496/prices")
        .end(done);
    });

    it("should return 404 when the isbn is not valid", function (done) {
      request
        .get("/v1/books/123456789/prices")
        .expect(404)
        .expect("Content-Type", "application/json; charset=utf-8")
        .expect({ error: "isbn '123456789' is not valid" })
        .end(done);
    });

    it("should redirect to .../GB/GBP", function (done) {
      request
        .get("/v1/books/9780340831496/prices")
        .set("X-Forwarded-For", "217.64.234.65, 127.0.0.1") // nhs.uk
        .expect(302)
        .expect("Cache-Control", "private, max-age=600")
        .expect("Location", testBaseUrl + "/v1/books/9780340831496/prices/GB/GBP")
        .end(done);
    });

    it("should redirect to .../GB/GBP (using ip parameter)", function (done) {
      request
        .get("/v1/books/9780340831496/prices?ip=217.64.234.65")
        .set("X-Forwarded-For", "127.0.0.1")
        .expect(302)
        .expect("Cache-Control", "private, max-age=600")
        .expect("Location", testBaseUrl + "/v1/books/9780340831496/prices/GB/GBP")
        .end(done);
    });

    it("should 404 for invalid ip parameter", function (done) {
      request
        .get("/v1/books/9780340831496/prices?ip=123.456.789.012")
        .set("X-Forwarded-For", "127.0.0.1")
        .expect(404)
        .expect({
          error: "'123.456.789.012' is not a valid IP address"
        })
        .end(done);
    });

    it("should use fallbacks when not able to geolocate", function (done) {
      request
        .get("/v1/books/9780340831496/prices")
        .set("X-Forwarded-For", "127.0.0.1")
        .expect(302)
        .expect("Cache-Control", "private, max-age=600")
        .expect(
          "Location",
          testBaseUrl + "/v1/books/9780340831496/prices/" + config.fallbackCountry + "/" + config.fallbackCurrency
        )
        .end(done);
    });

  });


  describe("/:country", function () {
    it("should 404 for bad country", function (done) {
      request
        .get("/v1/books/9780340831496/prices/XX")
        .expect(404)
        .end(done);
    });

    it("should redirect for fixable country", function (done) {
      request
        .get("/v1/books/9780340831496/prices/gb")
        .expect(301)
        .expect("Location", testBaseUrl + "/v1/books/9780340831496/prices/GB")
        .end(done);
    });

    it("should redirect to primary currency", function (done) {
      request
        .get("/v1/books/9780340831496/prices/GB")
        .expect(301)
        .expect("Location", testBaseUrl + "/v1/books/9780340831496/prices/GB/GBP")
        .end(done);
    });

    it("should cope with country that has no currency", function (done) {
      // AQ is Antartica, which has no currency
      request
        .get("/v1/books/9780340831496/prices/AQ")
        .expect(301)
        .expect("Location", testBaseUrl + "/v1/books/9780340831496/prices/AQ/USD")
        .end(done);
    });

  });


  describe("/:country/:currency", function () {
    it("should 404 for bad currency", function (done) {
      request
        .get("/v1/books/9780340831496/prices/GB/ABC")
        .expect(404)
        .end(done);
    });

    it("should redirect for fixable currency", function (done) {
      request
        .get("/v1/books/9780340831496/prices/GB/gBp")
        .expect(301)
        .expect("Location", testBaseUrl + "/v1/books/9780340831496/prices/GB/GBP")
        .end(done);
    });

    it("should redirect for fixable country and currency", function (done) {
      request
        .get("/v1/books/9780340831496/prices/gb/gBp")
        .expect(301)
        .expect("Location", testBaseUrl + "/v1/books/9780340831496/prices/GB/GBP")
        .end(done);
    });

    it("should redirect for fixable country and currency", function (done) {
      request
        .get("/v1/books/9780340831496/prices/gb/gBp?callback=foo")
        .expect(301)
        .expect("Location", testBaseUrl + "/v1/books/9780340831496/prices/GB/GBP?callback=foo")
        .end(done);
    });

    it("should not initiate any scrape requests", function (done) {

      var fetchStub = this.sandbox
        .stub(fetcher, "fetch")
        .yields(null, samples("fetch-9780340831496"));

      request
        .get("/v1/books/9780340831496/prices/GB/GBP")
        .expect(200)
        .end(function (err) {
          assert.ifError(err);
          assert(!fetchStub.called);
          done();
        });

    });

    it("should return values after vendor request", function (done) {

      var fetchStub = this.sandbox
        .stub(fetcher, "fetch")
        .yields(null, samples("fetch-9780340831496"));

      async.series(
        [
          function (cb) {
            // Get the list of prices, should be empty. Should not call the
            // fetch command.
            request
              .get("/v1/books/9780340831496/prices/GB/GBP")
              .expect(200)
              .expect("Cache-Control", helpers.cacheControl(config.minimumMaxAgeForPrices))
              .expect({
                request: {
                  isbn: "9780340831496",
                  country: "GB",
                  currency: "GBP",
                  url: booksBaseURL + "9780340831496/prices/GB/GBP",
                },
                results: [samples("getBookPricesForVendor-9780340831496-unfetched")],
              })
              .end(function (err) {
                assert.ifError(err);
                assert.equal(fetchStub.callCount, 0);
                cb();
              });
          },
          function (cb) {
            // hit the vendor endpoint to store the results in cache.
            request
              .get("/v1/books/9780340831496/prices/GB/GBP/test_vendor_1")
              .expect(200)
              .expect(samples("getBookPricesForVendor-9780340831496"))
              .end(cb);
          },
          this.waitForCache,
          function (cb) {
            // Get the currency endpoint and check that cached values are now
            // included.
            var expected = samples("getBookPricesForVendor-9780340831496");
            request
              .get("/v1/books/9780340831496/prices/GB/GBP")
              .expect(200)
              .expect("Cache-Control", helpers.cacheControl(expected.meta.ttl))
              .expect({
                request: {
                  isbn: "9780340831496",
                  country: "GB",
                  currency: "GBP",
                  url: booksBaseURL + "9780340831496/prices/GB/GBP",
                },
                results: [expected]
              })
              .end(cb);
          }
        ],
        done
      );
    });

    it("should convert currency correctly", function (done) {

      this.sandbox
        .stub(fetcher, "fetch")
        .yields(null, samples("fetch-9780340831496"));

      async.series(
        [
          function (cb) {
            // hit the vendor endpoint to store the results in cache.
            request
              .get("/v1/books/9780340831496/prices/GB/GBP/test_vendor_1")
              .expect(200)
              .expect(samples("getBookPricesForVendor-9780340831496"))
              .end(cb);
          },
          this.waitForCache,
          function (cb) {

            // Copy the expected results and change to USD
            var expected = samples("getBookPricesForVendor-9780340831496");
            expected.request.currency = "USD";
            expected.meta.preConversionCurrency = "GBP";
            expected.offers = {
              new: _.extend(
                {},
                expected.offers.new,
                { price: 39.31, total: 39.31 }
              )
            };
            expected.request.url = config.api.protocol + "://" + config.api.hostport + "/v1/books/9780340831496/prices/GB/USD/test_vendor_1";

            // Get the currency endpoint and check that cached values are now
            // included.
            request
              .get("/v1/books/9780340831496/prices/GB/USD")
              .expect(200)
              .expect({
                request: {
                  isbn: "9780340831496",
                  country: "GB",
                  currency: "USD",
                  url: booksBaseURL + "9780340831496/prices/GB/USD",
                },
                results: [expected]
              })
              .end(cb);
          }
        ],
        done
      );

    });

    it("should serve content-length", function (done) {
      request
        .get("/v1/books/9780340831496/prices/GB/GBP")
        .expect(200)
        .end(function (err, res) {
          assert(res.headers["content-length"]);
          done();
        });
    });

    it("should serve JSONP", function (done) {
      request
        .get("/v1/books/9780340831496/prices/GB/GBP?callback=foo")
        .expect(200)
        .expect("Content-Type", "text/javascript; charset=utf-8")
        .end(done);
    });

  });


  describe("/:country/:currency/:vendor", function () {

    beforeEach(function () {
      this.fetchStub = this.sandbox
        .stub(fetcher, "fetch")
        .yields(null, samples("fetch-9780340831496"));
    });

    it("should 404 for bad vendor", function (done) {
      request
        .get("/v1/books/9780340831496/prices/GB/GBP/not_a_vendor")
        .expect(404)
        .expect({
          "error": "vendor code 'not_a_vendor' is not recognised"
        })
        .end(done);
    });

    it("should redirect for fixable country, currency and vendor", function (done) {
      request
        .get("/v1/books/9780340831496/prices/gb/gBp/TEST_veNDor-1")
        .expect(301)
        .expect("Location", testBaseUrl + "/v1/books/9780340831496/prices/GB/GBP/test_vendor_1")
        .end(done);
    });

    it("should redirect for fixable country, currency and vendor (jsonp)", function (done) {
      request
        .get("/v1/books/9780340831496/prices/gb/gBp/TEST_veNDor-1?callback=foo")
        .expect(301)
        .expect("Location", testBaseUrl + "/v1/books/9780340831496/prices/GB/GBP/test_vendor_1?callback=foo")
        .end(done);
    });

    it("should 400 if the vendor does not sell to that country", function (done) {

      // return an error
      fetcher.vendorsForCountry.restore();
      this.sandbox
        .stub(fetcher, "vendorsForCountry")
        .withArgs("GB")
        .returns([]);

      request
        .get("/v1/books/9780340831496/prices/GB/GBP/test_vendor_1")
        .expect(400)
        .end(done);
    });


    it("should retrieve, scrape, store and serve correctly", function (done) {

      // var log = require("util").log;
      var clock        = this.sandbox.clock;
      // var delay        = this.delay;
      // var waitForCache = this.waitForCache;


      fetcher.fetch.restore();
      this.fetchStub = this.sandbox
        .stub(fetcher, "fetch", function (args, cb) {
          setTimeout(
            function () {
              cb(null, samples("fetch-9780340831496"));
            },
            (config.getBookPricesForVendorTimeout + 1 ) * 1000
          );

          clock.tick(config.getBookPricesForVendorTimeout * 1000);
        });

      async.series([

        // cache is empty, run a scrape that times out
        function (cb) {
          var expected = samples("getBookPricesForVendor-9780340831496-pending");
          expected.meta.timestamp = Math.floor(Date.now()/1000) + config.getBookPricesForVendorTimeout;

          request
            .get("/v1/books/9780340831496/prices/GB/GBP/test_vendor_1")
            .expect(200)
            .expect(expected)
            .expect("Cache-Control", helpers.cacheControl(config.retryDelayForPending))
            .end(cb);
        },

        // fetch again, should get a response at once
        this.delay(2000),     // wait a little more for the scraper to return
        this.waitForCache,    // let results get saved to cache
        function (cb) {

          var expectedContent = samples("getBookPricesForVendor-9780340831496");

          var expectedMaxAge = Math.floor(expectedContent.meta.timestamp + expectedContent.meta.ttl - Date.now()/1000);

          // Fire off another request that should get a completed scrape
          request
            .get("/v1/books/9780340831496/prices/GB/GBP/test_vendor_1")
            .expect(200)
            .expect("Cache-Control", helpers.cacheControl(expectedMaxAge))
            .expect(expectedContent)
            .end(cb);
        },

        // wait for ttl to pass
        function (cb) {
          var expectedContent = samples("getBookPricesForVendor-9780340831496");
          var expectedMaxAge = Math.floor(expectedContent.timestamp + expectedContent.ttl - Date.now()/1000);
          clock.tick(expectedMaxAge * 1000);
          cb();
        },

        // should get a pending response with stale data
        function (cb) {
          request
            .get("/v1/books/9780340831496/prices/GB/GBP/test_vendor_1")
            .expect(200)
            .expect(samples("getBookPricesForVendor-9780340831496-stale"))
            .expect("Cache-Control", helpers.cacheControl(0))
            .end(cb);
        },

        // let scrape complete, should have fresh data


      ], done);


    });


    it("should return a correctly scraped response", function (done) {

      // tick ahead a fraction of a second to test that the max-age is rounded
      // down to an integer.
      var tickAmount = 300;
      this.sandbox.clock.tick(tickAmount);

      request
        .get("/v1/books/9780340831496/prices/GB/GBP/test_vendor_1")
        .expect(200)
        .expect("Cache-Control", helpers.cacheControl(86400 - tickAmount/1000))
        .expect(samples("getBookPricesForVendor-9780340831496"))
        .end(done);

    });


    it("should retrieve from the cache on subsequent requests", function (done) {
      var runTests = function (cb) {
        request
          .get("/v1/books/9780340831496/prices/GB/GBP/test_vendor_1")
          .expect(200)
          .expect(samples("getBookPricesForVendor-9780340831496"))
          .end(cb);
      };

      var fetchStub = this.fetchStub;

      async.series(
        [
          runTests,
          this.waitForCache,
          runTests,
        ],
        function (err) {
          assert.ifError(err);
          assert.equal(fetchStub.callCount, 1);
          done();
        }
      );

    });

    it("should store and retrieve all data from one scrape", function (done) {
      var runTests = function (country) {
        return function (cb) {
          request
            .get("/v1/books/9780340831496/prices/" + country + "/GBP/test_vendor_1")
            .expect(200)
            .end(cb);
        };
      };

      var fetchStub = this.fetchStub;

      async.series(
        [
          runTests("GB"),
          this.waitForCache,
          runTests("US"),
        ],
        function (err) {
          assert.ifError(err);
          assert.equal(fetchStub.callCount, 1);
          done();
        }
      );

    });

    it("should convert currency correctly", function (done) {

      // Copy the expected results and change to USD
      var expected = samples("getBookPricesForVendor-9780340831496");
      expected.request.currency = "USD";
      expected.meta.preConversionCurrency = "GBP";
      expected.offers = {
        new: _.extend(
          {},
          expected.offers.new,
          { price: 39.31, total: 39.31 }
        )
      };
      expected.request.url = config.api.protocol + "://" + config.api.hostport + "/v1/books/9780340831496/prices/GB/USD/test_vendor_1";


      request
        .get("/v1/books/9780340831496/prices/GB/USD/test_vendor_1")
        .expect(200)
        .expect("Cache-Control", helpers.cacheControl(86400))
        .expect(expected)
        .end(done);

    });

    it("should not issue duplicate scrapes", function (done) {
      // if the api is asked to fetch the same details twice then only one
      // request should be sent to the vendor's site. The requests should both
      // block until there is something to return.

      var clock = this.sandbox.clock;
      var fetchStub = this.fetchStub;

      // function to request the details. Will be called multiple times.
      var getDetails = function (cb) {
        request
          .get("/v1/books/9780340831496/prices/GB/GBP/test_vendor_1")
          .expect(200)
          .expect(samples("getBookPricesForVendor-9780340831496"))
          .end(
            function (err) {
              // console.log("request complete");

              // Once a request is complete we can tick on to allow other
              // scrapes to proceed.
              clock.tick(config.duplicateScrapeBackoff);
              cb(err);
            }
          );
      };

      async.parallel(
        [
          getDetails,
          getDetails,
          getDetails,
        ],
        function (err) {
          assert.ifError(err);
          assert.equal(fetchStub.callCount, 1);
          done();
        }
      );

    });

    it("should serve content-length", function (done) {
      request
        .get("/v1/books/9780340831496/prices/GB/GBP/test_vendor_1")
        .expect(200)
        .end(function (err, res) {
          assert(res.headers["content-length"]);
          done();
        });
    });

    it("should serve JSONP", function (done) {
      request
        .get("/v1/books/9780340831496/prices/GB/GBP/test_vendor_1?callback=foo")
        .expect(200)
        .expect("Content-Type", "text/javascript; charset=utf-8")
        .end(done);
    });

    it("should 200 if the scraper has an error", function (done) {

      // stub the country so that GB is not accepted
      fetcher.fetch.restore();
      this.fetchStub = this.sandbox
        .stub(fetcher, "fetch")
        .yields(new Error("some error"), {});

      async.series([

        // initial request should return unfetched, as it is not in db
        function (cb) {
          request
            .get("/v1/books/9780340831496/prices/GB/GBP")
            .expect(200)
            .expect({
              request: {
                isbn: "9780340831496",
                country: "GB",
                currency: "GBP",
                url: booksBaseURL + "9780340831496/prices/GB/GBP",
              },
              results: [samples("getBookPricesForVendor-9780340831496-unfetched")]
            })
            .end(cb);
        },
        // request to scrape should return error response
        function (cb) {
          request
            .get("/v1/books/9780340831496/prices/GB/GBP/test_vendor_1")
            .expect(200)
            .expect(samples("getBookPricesForVendor-9780340831496-error"))
            .end(cb);
        },
        // subsequent list request should return cached error response
        function (cb) {
          request
            .get("/v1/books/9780340831496/prices/GB/GBP")
            .expect(200)
            .expect({
              request: {
                isbn: "9780340831496",
                country: "GB",
                currency: "GBP",
                url: booksBaseURL + "9780340831496/prices/GB/GBP",
              },
              results: [samples("getBookPricesForVendor-9780340831496-error")]
            })
            .end(cb);
        },

      ], done);
    });


  });


});
