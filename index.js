const express = require("express");
const parser = require('body-parser');
const favicon = require('serve-favicon')
const fs = require("fs");
const path = require("path")
const https = require("https");
const convert = require("xml-js");

const fetch = async (url) => {
    return new Promise((resolve, reject) => {
        const request = https.get(new URL(url), (response) => {
            var data = "";
            response.on("data", (chunk) => {
                data += chunk;
            });
            response.on("end", () => {
                resolve(data);
            });
        });
        request.on("error", (err) => {
            reject(err);
        });
    });
};

const processSearch = (data) => {
    const elements = convert.xml2js(data).elements;
    var count, queryKey, webEnv;
    for (var i = 0; i < elements.length; i++) {
        if (elements[i].name === "eSearchResult") {
            for (var j = 0; j < elements[i].elements.length; j++) {
                switch(elements[i].elements[j].name) {
                    case "Count":
                        count = elements[i].elements[j].elements[0].text;
                        break;
                    case "QueryKey":
                        queryKey = elements[i].elements[j].elements[0].text;
                        break;
                    case "WebEnv":
                        webEnv = elements[i].elements[j].elements[0].text;
                        break;
                }
            }
        }
    }
    return [count, queryKey, webEnv];
}

const processSummary = (data) => {
    const elements = convert.xml2js(data).elements;
    var title, authors, authorInitials, authorLast, journal, abstract, pubDate, pubYear, pubMonth, pubDay, doi;
    var summaries = [];
    for (var i = 0; i < elements.length; i++) {
        if (elements[i].name === "PubmedArticleSet") {
            for (var j = 0; j < elements[i].elements.length; j++) {
                for (var k = 0; k < elements[i].elements[j].elements.length; k++) {
                    if (elements[i].elements[j].elements[k].name === "MedlineCitation") {
                        for (var l = 0; l < elements[i].elements[j].elements[k].elements.length; l++) {
                            if (elements[i].elements[j].elements[k].elements[l].name === "Article") {
                                title = ""; authors = []; journal = ""; abstract = ""; doi = "";
                                for (var m = 0; m < elements[i].elements[j].elements[k].elements[l].elements.length; m++) {
                                    switch(elements[i].elements[j].elements[k].elements[l].elements[m].name) {
                                        case "ArticleTitle":
                                            title = elements[i].elements[j].elements[k].elements[l].elements[m].elements[0].text;
                                            break;
                                        case "AuthorList":
                                            elements[i].elements[j].elements[k].elements[l].elements[m].elements.forEach(e => { authorInitials = ""; authorLast = ""; e.elements.forEach(e => { switch (e.name) { case "LastName": authorLast = e.elements[0].text; break; case "Initials": authorInitials = e.elements[0].text; break; } }); authors.push(authorLast + ", " + authorInitials) });
                                            break;
                                        case "Journal":
                                            elements[i].elements[j].elements[k].elements[l].elements[m].elements.forEach(e => { if (e.name === "Title") journal = e.elements[0].text; });
                                            //pubDate = [pubYear, pubMonth, pubDay].join("-");
                                            break;
                                        case "Abstract":
                                            elements[i].elements[j].elements[k].elements[l].elements[m].elements.forEach(e => { if (e.name === "AbstractText") { if (e.elements) e.elements.forEach(e => { if (e.type === "text") abstract += e.text + " "; }) } });
                                            break;
                                        case "ELocationID":
                                            if (elements[i].elements[j].elements[k].elements[l].elements[m].attributes.EIdType === "doi") doi = "https://doi.org/" + elements[i].elements[j].elements[k].elements[l].elements[m].elements[0].text;
                                            break;
                                    }
                                }
                            }
                        }
                    } else if (elements[i].elements[j].elements[k].name === "PubmedData") {
                        pubYear = ""; pubMonth = ""; pubDay = ""; pubDate = "";
                        for (var n = 0; n < elements[i].elements[j].elements[k].elements.length; n++) {
                            if (elements[i].elements[j].elements[k].elements[n].name === "History") {
                                for (var o = 0; o < elements[i].elements[j].elements[k].elements[n].elements.length; o++) {
                                    if (elements[i].elements[j].elements[k].elements[n].elements[o].attributes.PubStatus === "pubmed") {
                                        elements[i].elements[j].elements[k].elements[n].elements[o].elements.forEach(e => { switch(e.name) { case "Year": pubYear = e.elements[0].text; break; case "Month": pubMonth = e.elements[0].text; break; case "Day": pubDay = e.elements[0].text; break; }});
                                        pubDate = [pubYear, pubMonth.padStart(2, "0"), pubDay.padStart(2, "0")].join("-");
                                    }
                                }
                            }
                        }
                    }
                }
                summaries.push([{name: "Title", value: title}, {name: "Authors", value: authors.join("; ")}, {name: "Journal", value: journal}, {name: "Publication Date", value: pubDate}, {name: "Abstract", value: abstract}, {name: "Link", value: doi}]);
            }
        }
    }
    return summaries;
};

const app = express();

app.use(parser.json());
app.use(parser.urlencoded({extended: false}));
app.use(favicon(path.join(__dirname, "static", "favicon.ico")));

app.set("views", "./views");
app.set("view engine", "pug");

app.get("/", async (req,res) => {
    const searchResults = await fetch("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?api_key=5a8c154e76a6cf874fac7ac38b5abe462e09&db=pubmed&term=(digital health OR mhealth)");
    var count = processSearch(searchResults)[0];
    count -= (count % 1000);

    const quickLinks = JSON.parse(fs.readFileSync("quicklinks.json", "utf8"));

    res.render("index", {count: count, quickLinks: quickLinks});
});

app.get("/static/:file", (req, res) => {
    res.sendFile(req.params.file, {root: path.join(__dirname, "static")});
});

app.get("/search/", async (req, res) => {
    const query = req.query.query;
    const sort = (req.query.sort && req.query.sort === "recent") ? "most+recent" : "relevance";
    const eutils = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
    const esearch = "esearch.fcgi?api_key=5a8c154e76a6cf874fac7ac38b5abe462e09&db=pubmed&usehistory=y&sort=" + sort + "&term=telemedicine" + ((query && query !== "") ? " AND (" + query + ")" : "");
    const esummary = "efetch.fcgi?api_key=5a8c154e76a6cf874fac7ac38b5abe462e09&db=pubmed&retmax=10&rettype=xml";
    const retstart = (req.query.start && Number.isInteger(parseFloat(req.query.start, 10))) ? parseFloat(req.query.start, 10) : 0;
    var count, queryKey, webEnv, summaries;

    const start = Date.now();

    const searchResults = await fetch(eutils + esearch);
    [count, queryKey, webEnv] = processSearch(searchResults);

    var next, window;

    const quickLinks = JSON.parse(fs.readFileSync("quicklinks.json", "utf8"));

    if (query || query === "") {
        if (retstart < (count - 10)) {
             next = "/search/?query=" + query + "&start=" + (retstart + 10) + "&sort=" + req.query.sort;
             window = [retstart + 1, retstart + 10];
         } else {
             next = null;
             window = [retstart + 1, count];
        }
        const summaryResults = await fetch(eutils + esummary + "&query_key=" + queryKey + "&WebEnv=" + webEnv + "&retstart=" + retstart);
        summaries = processSummary(summaryResults);
    } else {
        next = null;
        window = [];
        summaries = [];
    }

    res.render("search", {query: query, sort: req.query.sort, results: summaries, window: window, count: count, time: (Date.now() - start)/1000, next: next, quickLinks: quickLinks});
});

const server = app.listen(3100, () => {
    const now = new Date();
    console.log(now.toUTCString() + " - Digital Health Evidence listening on port 3100 (PID: " + process.pid + ")");
});

process.on("SIGTERM", () => {
    const now = new Date();
    server.close( () => { console.log (now.toUTCString() + " - Digital Health Evidence terminated"); } );
});
